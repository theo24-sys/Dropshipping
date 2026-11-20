/**
 * POST /functions/v1/paystack-webhook
 *
 * The only place an order becomes paid. Rules:
 *   * the HMAC-SHA512 signature over the raw body must match;
 *   * each provider event is stored once (webhook_events unique key), so a
 *     replay cannot pay an order twice;
 *   * the amount and currency must match the recorded payment;
 *   * database updates are conditional, so concurrent deliveries are safe.
 *
 * Set the endpoint in the Paystack dashboard. JWT verification is disabled for
 * this function in config.toml because Paystack cannot send a Supabase JWT.
 */
import { json, preflight } from "../_shared/http.ts";
import { serviceClient } from "../_shared/db.ts";
import { verifySignature } from "../_shared/paystack.ts";

type PaystackEvent = {
  event?: string;
  data?: {
    id?: number | string;
    reference?: string;
    amount?: number;
    currency?: string;
    status?: string;
    paid_at?: string;
    metadata?: { order_number?: string };
  };
};

function ok(req: Request, body: Record<string, unknown>): Response {
  return json(req, { received: true, ...body }, 200);
}

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;

  if (req.method !== "POST") {
    return json(req, { error: "Method not allowed." }, 405);
  }

  const raw = await req.text();
  const signature = req.headers.get("x-paystack-signature");

  if (!(await verifySignature(raw, signature))) {
    // Never process an unverified payload, even if it looks correct.
    return json(req, { error: "Invalid signature." }, 401);
  }

  let payload: PaystackEvent;
  try {
    payload = JSON.parse(raw) as PaystackEvent;
  } catch {
    return json(req, { error: "Invalid JSON." }, 400);
  }

  const event = String(payload.event ?? "");
  const data = payload.data ?? {};
  const reference = String(data.reference ?? "");
  const db = serviceClient();

  if (!reference) return ok(req, { status: "ignored", reason: "no_reference" });

  const eventId = `${event}:${data.id ?? reference}`;
  const { error: eventError } = await db.from("webhook_events").insert({
    provider: "paystack",
    provider_event_id: eventId,
    event_type: event,
    payload: payload as Record<string, unknown>,
  });

  if (eventError?.code === "23505") {
    return ok(req, { status: "duplicate" });
  }
  if (eventError) {
    console.error("Could not record webhook event", eventError);
    return json(req, { error: "Could not record the event." }, 500);
  }

  // Refund lifecycle events are informational: they update the refund row that
  // staff created, and never create money movement on their own.
  if (event === "refund.processed" || event === "refund.pending" || event === "refund.failed") {
    const refundReference = String((data as Record<string, unknown>).id ?? "");
    if (refundReference) {
      await db
        .from("refunds")
        .update({
          status: event === "refund.processed" ? "completed" : event === "refund.failed" ? "failed" : "processing",
          processed_at: event === "refund.processed" ? new Date().toISOString() : null,
        })
        .eq("provider_refund_reference", refundReference);
    }
    await db
      .from("webhook_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("provider", "paystack")
      .eq("provider_event_id", eventId);
    return ok(req, { status: "refund_updated" });
  }

  if (event !== "charge.success") {
    await db
      .from("webhook_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("provider", "paystack")
      .eq("provider_event_id", eventId);
    return ok(req, { status: "ignored", reason: "unhandled_event" });
  }

  const { data: payment, error: paymentError } = await db
    .from("payments")
    .select("id, order_id, amount_usd, status, provider_currency")
    .eq("provider", "paystack")
    .eq("provider_reference", reference)
    .maybeSingle();

  if (paymentError) {
    console.error("Payment lookup failed", paymentError);
    return json(req, { error: "Could not load the payment." }, 500);
  }
  if (!payment) {
    // Unknown reference: acknowledge so Paystack stops retrying, but do nothing.
    console.warn("Webhook referenced an unknown payment", reference);
    return ok(req, { status: "ignored", reason: "unknown_reference" });
  }

  const expectedCents = Math.round(Number(payment.amount_usd) * 100);
  const receivedCents = Number(data.amount ?? 0);
  const currency = String(data.currency ?? "").toUpperCase();

  if (receivedCents !== expectedCents || (currency && currency !== "USD")) {
    console.error("Webhook amount mismatch", { reference, expectedCents, receivedCents, currency });
    await db
      .from("payments")
      .update({ status: "failed", failure_reason: "Amount or currency did not match the order." })
      .eq("id", payment.id)
      .neq("status", "succeeded");
    return ok(req, { status: "ignored", reason: "amount_mismatch" });
  }

  if (data.status && String(data.status) !== "success") {
    await db
      .from("payments")
      .update({ status: "failed", failure_reason: `Provider status: ${data.status}` })
      .eq("id", payment.id)
      .neq("status", "succeeded");
    return ok(req, { status: "payment_not_successful" });
  }

  const paidAt = data.paid_at ? new Date(data.paid_at).toISOString() : new Date().toISOString();

  // Conditional update: only the first delivery changes the row.
  const { data: updatedPayment, error: updateError } = await db
    .from("payments")
    .update({
      status: "succeeded",
      verified_at: new Date().toISOString(),
      raw_payload: payload as Record<string, unknown>,
      provider_amount: receivedCents / 100,
      provider_currency: currency || "USD",
    })
    .eq("id", payment.id)
    .neq("status", "succeeded")
    .select("id");

  if (updateError) {
    console.error("Payment update failed", updateError);
    return json(req, { error: "Could not record the payment." }, 500);
  }
  if (!updatedPayment || updatedPayment.length === 0) {
    return ok(req, { status: "already_processed" });
  }

  const { data: updatedOrder, error: orderError } = await db
    .from("orders")
    .update({ status: "paid", paid_at: paidAt })
    .eq("id", payment.order_id)
    .eq("status", "pending_payment")
    .select("id, order_number");

  if (orderError) {
    console.error("Order update failed after verified payment", orderError, { reference });
    return json(req, { error: "Payment recorded but the order was not updated." }, 500);
  }

  if (!updatedOrder || updatedOrder.length === 0) {
    // Paid, but the order had already moved on (cancelled/refunded). Flag it for
    // staff rather than silently keeping the money.
    console.error("Payment succeeded for an order that is not pending", {
      reference,
      orderId: payment.order_id,
    });
  }

  await db
    .from("webhook_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("provider", "paystack")
    .eq("provider_event_id", eventId);

  return ok(req, { status: "paid" });
});
