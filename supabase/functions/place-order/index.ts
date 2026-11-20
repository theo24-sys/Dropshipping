/**
 * POST /functions/v1/place-order
 *
 * Creates an order in `pending_payment`. Prices, shipping and availability are
 * recomputed here from the database — the request's own totals are ignored, so a
 * tampered browser cannot buy a product for less than it costs.
 *
 * This function never marks an order paid and never contacts a supplier.
 * Guest checkout is supported; a bearer token links the order to a profile.
 */
import { HttpError, fail, json, preflight, readJson, requirePost } from "../_shared/http.ts";
import { callerFrom, serviceClient } from "../_shared/db.ts";
import { currencyFor } from "../_shared/markets.ts";
import {
  asAddress,
  asEmail,
  asMarket,
  asPhone,
  asQuantity,
  asText,
  asUuid,
  MAX_ITEMS,
  money,
  optionalText,
} from "../_shared/validate.ts";

type OrderItemInput = {
  productId: string;
  quantity: number;
  variantLabel: string;
};

type ProductRow = {
  id: string;
  name: string;
  sku: string;
  price_usd: number | string;
  status: string;
  destinations: string[] | null;
  product_variants: { name: string; options: string[] }[] | null;
};

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;

  try {
    requirePost(req);
    const body = await readJson(req);

    const market = asMarket(body.market);

    const customer = body.customer;
    if (!customer || typeof customer !== "object") {
      throw new HttpError(400, "Contact details are required.", "invalid_customer");
    }
    const contact = customer as Record<string, unknown>;
    const fullName = asText(contact.name, "name", 2, 120);
    const email = asEmail(contact.email);
    const phone = asPhone(contact.phone);

    const address = asAddress(body.address, market);
    const customerNote = optionalText(body.customerNote, "note", 500);
    const idempotencyKey = body.idempotencyKey
      ? asText(body.idempotencyKey, "idempotency key", 8, 64)
      : null;

    if (!Array.isArray(body.items) || body.items.length === 0) {
      throw new HttpError(400, "Your cart is empty.", "empty_cart");
    }
    if (body.items.length > MAX_ITEMS) {
      throw new HttpError(400, "That is too many different products in one order.", "cart_too_large");
    }

    const items: OrderItemInput[] = body.items.map((raw, index) => {
      if (!raw || typeof raw !== "object") {
        throw new HttpError(400, `Item ${index + 1} is not valid.`, "invalid_item");
      }
      const record = raw as Record<string, unknown>;
      return {
        productId: asUuid(record.productId, `items[${index + 1}]`),
        quantity: asQuantity(record.quantity),
        variantLabel: optionalText(record.variantLabel, "variant", 60),
      };
    });

    const db = serviceClient();

    // Repeat submissions (double click, retry after a timeout) return the first
    // order instead of creating a second one.
    if (idempotencyKey) {
      const { data: existing } = await db
        .from("orders")
        .select("order_number, market, currency_display, subtotal_usd, shipping_usd, total_usd")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();

      if (existing) {
        return json(req, {
          orderNumber: existing.order_number,
          market: existing.market,
          displayCurrency: existing.currency_display,
          totals: {
            subtotalUsd: Number(existing.subtotal_usd),
            shippingUsd: Number(existing.shipping_usd),
            totalUsd: Number(existing.total_usd),
          },
          duplicate: true,
        });
      }
    }

    const productIds = [...new Set(items.map((item) => item.productId))];
    const { data: productRows, error: productError } = await db
      .from("products")
      .select("id, name, sku, price_usd, status, destinations, product_variants(name, options)")
      .in("id", productIds);

    if (productError) {
      console.error("Product lookup failed", productError);
      throw new HttpError(500, "We could not check the catalogue. Please try again.", "catalogue_error");
    }

    const products = new Map<string, ProductRow>();
    for (const row of (productRows ?? []) as ProductRow[]) products.set(row.id, row);

    type PricedLine = {
      productId: string;
      name: string;
      sku: string;
      quantity: number;
      unitPrice: number;
      lineTotal: number;
      variantLabel: string;
    };

    const lines: PricedLine[] = [];
    for (const item of items) {
      const product = products.get(item.productId);
      if (!product) {
        throw new HttpError(409, "One of the products is no longer available.", "product_unavailable");
      }
      if (product.status !== "published") {
        throw new HttpError(409, `“${product.name}” is not on sale right now.`, "product_unavailable");
      }
      if (!(product.destinations ?? []).includes(market)) {
        throw new HttpError(
          409,
          `“${product.name}” cannot be shipped to that country.`,
          "destination_unavailable",
        );
      }

      const optionLabels = (product.product_variants ?? [])
        .flatMap((variant) => variant.options ?? [])
        .map((option) => String(option));

      if (optionLabels.length > 0) {
        if (!item.variantLabel) {
          throw new HttpError(400, `Choose an option for “${product.name}”.`, "variant_required");
        }
        if (!optionLabels.includes(item.variantLabel)) {
          throw new HttpError(409, `That option for “${product.name}” is not available.`, "variant_unavailable");
        }
      }

      const unitPrice = money(Number(product.price_usd));
      lines.push({
        productId: product.id,
        name: product.name,
        sku: product.sku,
        quantity: item.quantity,
        unitPrice,
        lineTotal: money(unitPrice * item.quantity),
        variantLabel: item.variantLabel,
      });
    }

    const subtotal = money(lines.reduce((sum, line) => sum + line.lineTotal, 0));
    const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);

    const { data: shipping, error: shippingError } = await db
      .from("shipping_methods")
      .select("flat_usd, per_additional_usd, min_days, max_days")
      .eq("market", market)
      .eq("is_active", true)
      .order("flat_usd", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (shippingError) {
      console.error("Shipping lookup failed", shippingError);
      throw new HttpError(500, "We could not price delivery. Please try again.", "shipping_error");
    }
    if (!shipping) {
      throw new HttpError(
        503,
        "Delivery to that country is not open yet, so no order was created.",
        "shipping_unavailable",
      );
    }

    const shippingUsd = money(
      Number(shipping.flat_usd) + Number(shipping.per_additional_usd) * (itemCount - 1),
    );
    const total = money(subtotal + shippingUsd);

    if (total <= 0) {
      throw new HttpError(400, "That order total is not valid.", "invalid_total");
    }

    const caller = await callerFrom(req);
    const displayCurrency = currencyFor(market);

    const { data: order, error: orderError } = await db
      .from("orders")
      .insert({
        user_id: caller?.id ?? null,
        email,
        full_name: fullName,
        phone,
        market,
        currency_display: displayCurrency,
        subtotal_usd: subtotal,
        shipping_usd: shippingUsd,
        total_usd: total,
        status: "pending_payment",
        shipping_address: address,
        customer_note: customerNote || null,
        idempotency_key: idempotencyKey,
      })
      .select("id, order_number, market, currency_display, subtotal_usd, shipping_usd, total_usd")
      .single();

    if (orderError?.code === "23505" && idempotencyKey) {
      const { data: existing } = await db
        .from("orders")
        .select("order_number, market, currency_display, subtotal_usd, shipping_usd, total_usd")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (existing) {
        return json(req, {
          orderNumber: existing.order_number,
          market: existing.market,
          displayCurrency: existing.currency_display,
          totals: {
            subtotalUsd: Number(existing.subtotal_usd),
            shippingUsd: Number(existing.shipping_usd),
            totalUsd: Number(existing.total_usd),
          },
          duplicate: true,
        });
      }
    }

    if (orderError || !order) {
      console.error("Order insert failed", orderError);
      throw new HttpError(500, "Your order could not be created. Nothing has been charged.", "order_error");
    }

    const { error: itemsError } = await db.from("order_items").insert(
      lines.map((line) => ({
        order_id: order.id,
        product_id: line.productId,
        variant_id: null,
        name_snapshot: line.name,
        sku_snapshot: line.sku,
        variant_label: line.variantLabel || null,
        quantity: line.quantity,
        unit_price_usd: line.unitPrice,
        line_total_usd: line.lineTotal,
      })),
    );

    if (itemsError) {
      console.error("Order items insert failed; rolling back", itemsError);
      await db.from("orders").delete().eq("id", order.id);
      throw new HttpError(500, "Your order could not be saved. Nothing has been charged.", "order_error");
    }

    return json(
      req,
      {
        orderNumber: order.order_number,
        market: order.market,
        displayCurrency: order.currency_display,
        totals: {
          subtotalUsd: Number(order.subtotal_usd),
          shippingUsd: Number(order.shipping_usd),
          totalUsd: Number(order.total_usd),
        },
        items: lines.map((line) => ({
          name: line.name,
          quantity: line.quantity,
          lineTotalUsd: line.lineTotal,
          variantLabel: line.variantLabel || null,
        })),
        payment: { status: "pending", charged: false },
      },
      201,
    );
  } catch (error) {
    return fail(req, error);
  }
});
