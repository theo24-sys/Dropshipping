/**
 * POST /functions/v1/cj-sync  (staff only)
 *
 * Body: { action, ... }
 *
 * Actions
 *   sync_product          { productId }  refresh cost/stock from the mapped CJ item
 *   check_stock           { productId }  refresh supplier stock + availability
 *   shipping_estimate     { productId, market, quantity? }  live freight quote
 *   create_supplier_order { orderId }    submit a *paid* order to CJ
 *   sync_tracking         { orderId }    pull tracking for a submitted order
 *
 * Guards that matter:
 *   * every call needs staff credentials AND CJ credentials;
 *   * an order is only submitted once `paid_at` is set and the status is
 *     paid/processing — money is verified before any supplier sees the order;
 *   * a supplier order is never created twice for the same MORGGY order.
 *
 * NOTE: CJ's v2 payloads differ between accounts. The createOrderV2 body below
 * is the documented shape, but it must be checked against the live account
 * before this action is relied on. Nothing here is claimed as tested.
 */
import { HttpError, fail, json, preflight, readJson, requirePost } from "../_shared/http.ts";
import { requireStaff, serviceClient } from "../_shared/db.ts";
import { cjConfigured, createSupplierOrder, freightEstimate, getProduct, getSupplierOrder } from "../_shared/cj.ts";
import { asMarket, asText, asUuid } from "../_shared/validate.ts";

type Mapping = {
  id: string;
  supplier_id: string;
  supplier_product_id: string;
  supplier_product_code: string | null;
};

async function requireMapping(productId: string): Promise<Mapping> {
  const db = serviceClient();
  const { data, error } = await db
    .from("supplier_products")
    .select("id, supplier_id, supplier_product_id, mapping_status")
    .eq("product_id", productId)
    .eq("mapping_status", "mapped")
    .not("supplier_product_id", "is", null)
    .maybeSingle();

  if (error) {
    console.error("Mapping lookup failed", error);
    throw new HttpError(500, "Could not read the supplier mapping.", "mapping_lookup_failed");
  }
  if (!data?.supplier_product_id) {
    throw new HttpError(
      409,
      "This product has no mapped supplier item yet. Map it before syncing.",
      "product_unmapped",
    );
  }
  return {
    id: data.id,
    supplier_id: data.supplier_id,
    supplier_product_id: data.supplier_product_id,
    supplier_product_code: null,
  };
}

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;

  try {
    requirePost(req);
    await requireStaff(req);
    if (!cjConfigured()) {
      throw new HttpError(
        503,
        "CJdropshipping is not connected: CJ_API_EMAIL and CJ_API_KEY are not set.",
        "supplier_not_configured",
      );
    }

    const body = await readJson(req);
    const action = asText(body.action, "action", 3, 40);
    const db = serviceClient();

    if (action === "sync_product" || action === "check_stock") {
      const productId = asUuid(body.productId, "productId");
      const mapping = await requireMapping(productId);
      const supplierProduct = await getProduct(mapping.supplier_product_id);

      const supplierStock =
        toNumber(supplierProduct.inventory) ??
        toNumber(supplierProduct.stock) ??
        toNumber((supplierProduct as Record<string, unknown>).totalInventory);

      const availability = supplierStock === null
        ? "unknown"
        : supplierStock > 0
        ? "in_stock"
        : "out_of_stock";

      const { error: inventoryError } = await db
        .from("inventory")
        .upsert(
          {
            product_id: productId,
            variant_id: null,
            supplier_stock: supplierStock,
            availability,
            checked_at: new Date().toISOString(),
          },
          { onConflict: "product_id,variant_id" },
        );

      if (inventoryError) {
        console.error("Inventory upsert failed", inventoryError);
        throw new HttpError(500, "Could not record the stock check.", "inventory_update_failed");
      }

      const cost = toNumber(supplierProduct.sellPrice) ?? toNumber(supplierProduct.productPrice);
      const { error: mappingError } = await db
        .from("supplier_products")
        .update({
          cost_usd: cost,
          last_synced_at: new Date().toISOString(),
          sync_error: null,
        })
        .eq("id", mapping.id);

      if (mappingError) {
        console.error("Mapping sync failed", mappingError);
        throw new HttpError(500, "Could not record the sync.", "mapping_update_failed");
      }

      return json(req, {
        action,
        productId,
        supplierProductId: mapping.supplier_product_id,
        supplierStock,
        availability,
        costUsd: cost,
        syncedAt: new Date().toISOString(),
      });
    }

    if (action === "shipping_estimate") {
      const productId = asUuid(body.productId, "productId");
      const market = asMarket(body.market);
      const quantity = Math.max(1, Math.min(20, Number(body.quantity ?? 1) || 1));
      const mapping = await requireMapping(productId);

      const optionsRaw = await freightEstimate({
        destinationCountry: market,
        supplierProductId: mapping.supplier_product_id,
        quantity,
      });

      return json(req, {
        action,
        market,
        options: optionsRaw.map((row) => ({
          name: row.logisticName ?? row.logisticCode ?? null,
          priceUsd: toNumber(row.logisticPrice),
          aging: row.logisticAging ?? null,
          raw: row,
        })),
        note: "A live quote from CJ. It is not stored as our customer rate.",
      });
    }

    if (action === "create_supplier_order") {
      const orderId = asUuid(body.orderId, "orderId");

      const { data: order, error: orderError } = await db
        .from("orders")
        .select("id, order_number, status, paid_at, market, full_name, phone, shipping_address, total_usd")
        .eq("id", orderId)
        .maybeSingle();

      if (orderError) {
        console.error("Order lookup failed", orderError);
        throw new HttpError(500, "Could not load that order.", "order_lookup_failed");
      }
      if (!order) throw new HttpError(404, "Order not found.", "order_not_found");

      if (!order.paid_at || !["paid", "processing"].includes(order.status)) {
        throw new HttpError(
          409,
          "This order has no verified payment, so it cannot be sent to the supplier.",
          "order_not_paid",
        );
      }

      const { data: existingShipment } = await db
        .from("shipments")
        .select("id, supplier_order_reference")
        .eq("order_id", order.id)
        .not("supplier_order_reference", "is", null)
        .maybeSingle();

      if (existingShipment?.supplier_order_reference) {
        throw new HttpError(
          409,
          `This order was already submitted to the supplier (${existingShipment.supplier_order_reference}).`,
          "order_already_submitted",
        );
      }

      const { data: items, error: itemsError } = await db
        .from("order_items")
        .select("product_id, quantity, name_snapshot, variant_label")
        .eq("order_id", order.id);

      if (itemsError || !items?.length) {
        console.error("Order items lookup failed", itemsError);
        throw new HttpError(500, "Could not read the order lines.", "order_items_failed");
      }

      const products: Record<string, unknown>[] = [];
      for (const item of items) {
        if (!item.product_id) {
          throw new HttpError(
            409,
            `“${item.name_snapshot}” has no catalogue record and cannot be mapped to a supplier item.`,
            "product_unmapped",
          );
        }
        const mapping = await requireMapping(item.product_id);
        products.push({
          vid: mapping.supplier_product_id,
          quantity: item.quantity,
        });
      }

      const address = (order.shipping_address ?? {}) as Record<string, string>;
      const payload = {
        orderNumber: order.order_number,
        shippingCountryCode: order.market,
        shippingCountry: order.market === "SG" ? "Singapore" : "Malaysia",
        shippingProvince: address.state || "",
        shippingCity: address.city || "",
        shippingAddress: [address.line1, address.line2].filter(Boolean).join(", "),
        shippingCustomerName: order.full_name,
        shippingZip: address.postcode || "",
        shippingPhone: order.phone || "",
        remark: `MORGGY ${order.order_number}`,
        products,
      };

      const supplierOrder = await createSupplierOrder(payload);
      const supplierReference = String(
        supplierOrder.orderId ?? supplierOrder.orderNumber ?? supplierOrder.cjOrderId ?? "",
      );

      if (!supplierReference) {
        console.error("CJ returned no order reference", supplierOrder);
        throw new HttpError(
          502,
          "CJ accepted the request but returned no order reference. Check the CJ dashboard before retrying.",
          "supplier_reference_missing",
        );
      }

      const { data: mappingRow } = await db
        .from("supplier_products")
        .select("supplier_id")
        .eq("product_id", items[0].product_id)
        .maybeSingle();

      await db.from("shipments").insert({
        order_id: order.id,
        supplier_id: mappingRow?.supplier_id ?? null,
        supplier_order_reference: supplierReference,
        status: "pending",
      });

      await db
        .from("orders")
        .update({ status: "submitted" })
        .eq("id", order.id)
        .in("status", ["paid", "processing"]);

      return json(req, {
        action,
        orderNumber: order.order_number,
        supplierOrderReference: supplierReference,
        status: "submitted",
      });
    }

    if (action === "sync_tracking") {
      const orderId = asUuid(body.orderId, "orderId");

      const { data: shipment } = await db
        .from("shipments")
        .select("id, supplier_order_reference, carrier, tracking_number, status, order_id")
        .eq("order_id", orderId)
        .not("supplier_order_reference", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!shipment?.supplier_order_reference) {
        throw new HttpError(
          409,
          "This order has not been submitted to the supplier yet, so there is no tracking to sync.",
          "no_supplier_order",
        );
      }

      const detail = await getSupplierOrder(String(shipment.supplier_order_reference));
      const trackingNumber = String(detail.trackNumber ?? detail.trackingNumber ?? "") || null;

      if (!trackingNumber) {
        return json(req, {
          action,
          orderId,
          trackingNumber: null,
          note: "CJ has not issued a tracking number yet.",
        });
      }

      const carrier = String(detail.logisticName ?? shipment.carrier ?? "") || null;

      await db
        .from("shipments")
        .update({
          tracking_number: trackingNumber,
          carrier,
          status: "in_transit",
          shipped_at: shipment.status === "pending" ? new Date().toISOString() : undefined,
        })
        .eq("id", shipment.id);

      await db
        .from("orders")
        .update({ status: "shipped" })
        .eq("id", orderId)
        .in("status", ["submitted", "processing"]);

      return json(req, { action, orderId, trackingNumber, carrier, status: "in_transit" });
    }

    throw new HttpError(400, "Unknown action.", "unknown_action");
  } catch (error) {
    return fail(req, error);
  }
});
