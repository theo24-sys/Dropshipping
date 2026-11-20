/**
 * POST /functions/v1/flutterwave-webhook
 *
 * Flutterwave sends a static `verif-hash` header. Because that header is the
 * same for every event, the transaction is re-verified against the API before
 * any order is marked paid. Duplicate deliveries are absorbed by webhook_events.
 */
import { json, preflight } from "../_shared/http.ts";
import { serviceClient } from "../_shared/db.ts";
import { verifyPayment, verifyWebhookHash } from "../_shared/flutterwave.ts";

type FlutterwaveEvent = {
  event?: string;
  data?: {
    id?: number | string;
    tx_ref?: string;
    amount?: number;
    currency?: string;
    status?: string;
  };
};

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;

  if (req.method !== "POST") return json(req, { error: "Method not allowed." }, 405);

  const raw = await req.text();
  if (!verifyWebhookHash(req.headers.get("verif-hash"))) {
    return json(req, { error: "Invalid signature." }, 401);
  }

  let payload: FlutterwaveEvent;
  try {
    payload = JSON.parse(raw) as FlutterwaveEvent;
  } catch {
    return json(req, { error: "Invalid JSON." }, 400);
  }

  const data = payload.data ?? {};
  const reference = String(data.tx_ref ?? "");
  const event = String(payload.event ?? "");
  if (!reference) return json(req, { received: true, status: "ignored" }, 200);

  const db = serviceClient();
  const eventId = `${event}:${data.id ?? reference}`;

  const { error: eventError } = await db.from("webhook_events").insert({
    provider: "flutterwave",
    provider_event_id: eventId,
    event_type: event,
    payload: payload as Record<string, unknown>,
  });

  if (eventError?.code === "23505") {
    return json(req, { received: true, status: "duplicate" }, 200);
  }
  if (eventError) {
    console.error("Could not record Flutterwave event", eventError);
    return json(req, { error: "Could not record the event." }, 500);
  }

  if (event !== "charge.completed") {
    return json(req, { received: true, status: "ignored" }, 200);
  }

  // Never trust the payload alone — ask Flutterwave for the transaction.
  let verified;
  try {
    verified = await verifyPayment(String(data.id ?? ""));
  } catch (error) {
    console.error("Flutterwave verification failed", error);
    return json(req, { error: "Could not verify the transaction." }, 502);
  }

  if (verified.status !== "successful" || verified.txRef !== reference) {
    return json(req, { received: true, status: "not_paid" }, 200);
  }

  const { data: payment, error: paymentError } = await db
    .from("payments")
    .select("id, order_id, amount_usd, status")
    .eq("provider", "flutterwave")
    .eq("provider_reference", reference)
    .maybeSingle();

  if (paymentError) {
    console.error("Payment lookup failed", paymentError);
    return json(req, { error: "Could not load the payment." }, 500);
  }
  if (!payment) {
    console.warn("Flutterwave webhook referenced an unknown payment", reference);
    return json(req, { received: true, status: "ignored" }, 200);
  }

  const expected = Math.round(Number(payment.amount_usd) * 100) / 100;
  if (Math.abs(verified.amount - expected) > 0.009 || verified.currency !== "USD") {
    console.error("Flutterwave amount mismatch", { reference, expected, verified });
    await db
      .from("payments")
      .update({ status: "failed", failure_reason: "Amount or currency did not match the order." })
      .eq("id", payment.id)
      .neq("status", "succeeded");
    return json(req, { received: true, status: "amount_mismatch" }, 200);
  }

  const { data: updated, error } = await db
    .from("payments")
    .update({
      status: "succeeded",
      verified_at: new Date().toISOString(),
      provider_amount: verified.amount,
      provider_currency: verified.currency,
      raw_payload: payload as Record<string, unknown>,
    })
    .eq("id", payment.id)
    .neq("status", "succeeded")
    .select("id");

  if (error) {
    console.error("Payment update failed", error);
    return json(req, { error: "Could not record the payment." }, 500);
  }
  if (!updated || updated.length === 0) {
    return json(req, { received: true, status: "already_processed" }, 200);
  }

  await db
    .from("orders")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", payment.order_id)
    .eq("status", "pending_payment");

  await db
    .from("webhook_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("provider", "flutterwave")
    .eq("provider_event_id", eventId);

  return json(req, { received: true, status: "paid" }, 200);
});
