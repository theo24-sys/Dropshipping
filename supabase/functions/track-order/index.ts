/**
 * POST /functions/v1/track-order
 *
 * Body: { orderNumber, email }
 *
 * Returns the status of one order when the email matches. The response is
 * deliberately identical for "no such order" and "wrong email" so order numbers
 * cannot be enumerated. Only real database values are returned: there is no
 * invented tracking number or carrier.
 */
import { HttpError, fail, json, preflight, readJson, requirePost } from "../_shared/http.ts";
import { serviceClient } from "../_shared/db.ts";
import { asEmail, asText } from "../_shared/validate.ts";

const STATUS_COPY: Record<string, string> = {
  pending_payment: "Awaiting payment",
  paid: "Paid — being prepared with the supplier",
  processing: "Processing with the supplier",
  submitted: "Order placed with the supplier",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;

  try {
    requirePost(req);
    const body = await readJson(req);
    const orderNumber = asText(body.orderNumber, "order number", 6, 40);
    const email = asEmail(body.email);

    const db = serviceClient();
    const { data: order, error } = await db
      .from("orders")
      .select("id, order_number, email, market, status, placed_at, paid_at, subtotal_usd, shipping_usd, total_usd, currency_display")
      .eq("order_number", orderNumber)
      .maybeSingle();

    if (error) {
      console.error("Track lookup failed", error);
      throw new HttpError(500, "We could not look that order up. Please try again.", "lookup_failed");
    }

    if (!order || order.email.toLowerCase() !== email) {
      throw new HttpError(404, "We could not find an order with those details.", "order_not_found");
    }

    const [{ data: items }, { data: shipments }] = await Promise.all([
      db
        .from("order_items")
        .select("name_snapshot, variant_label, quantity, line_total_usd")
        .eq("order_id", order.id),
      db
        .from("shipments")
        .select("carrier, tracking_number, tracking_url, status, shipped_at, delivered_at")
        .eq("order_id", order.id),
    ]);

    return json(req, {
      orderNumber: order.order_number,
      status: order.status,
      statusLabel: STATUS_COPY[order.status] ?? order.status,
      market: order.market,
      displayCurrency: order.currency_display,
      placedAt: order.placed_at,
      paidAt: order.paid_at,
      totals: {
        subtotalUsd: Number(order.subtotal_usd),
        shippingUsd: Number(order.shipping_usd),
        totalUsd: Number(order.total_usd),
      },
      items: (items ?? []).map((item) => ({
        name: item.name_snapshot,
        variant: item.variant_label,
        quantity: item.quantity,
        lineTotalUsd: Number(item.line_total_usd),
      })),
      shipments: (shipments ?? []).map((shipment) => ({
        carrier: shipment.carrier,
        trackingNumber: shipment.tracking_number,
        trackingUrl: shipment.tracking_url,
        status: shipment.status,
        shippedAt: shipment.shipped_at,
        deliveredAt: shipment.delivered_at,
      })),
      note: (shipments ?? []).length
        ? null
        : "No parcel has been handed to a carrier yet, so there is no tracking number to show.",
    });
  } catch (error) {
    return fail(req, error);
  }
});
