/**
 * POST /functions/v1/verify-payment  (staff only)
 *
 * Body: { paymentId }
 *
 * Re-checks a payment against Paystack and, if it really succeeded, records it
 * exactly as the webhook would. Useful when a webhook delivery was lost. It is
 * never used by the storefront — a redirect is not proof of payment.
 */
import { HttpError, fail, json, preflight, readJson, requirePost } from "../_shared/http.ts";
import { requireStaff, serviceClient } from "../_shared/db.ts";
import { verifyTransaction } from "../_shared/paystack.ts";
import { asUuid } from "../_shared/validate.ts";

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;

  try {
    requirePost(req);
    await requireStaff(req);

    const body = await readJson(req);
    const paymentId = asUuid(body.paymentId, "paymentId");

    const db = serviceClient();
    const { data: payment, error } = await db
      .from("payments")
      .select("id, order_id, provider, provider_reference, amount_usd, status")
      .eq("id", paymentId)
      .maybeSingle();

    if (error) {
      console.error("Payment lookup failed", error);
      throw new HttpError(500, "Could not load that payment.", "payment_lookup_failed");
    }
    if (!payment) throw new HttpError(404, "Payment not found.", "payment_not_found");
    if (!payment.provider_reference) {
      throw new HttpError(409, "This payment has no provider reference to check.", "no_reference");
    }

    if (payment.provider !== "paystack") {
      throw new HttpError(
        501,
        "Automatic verification is implemented for Paystack. Check Flutterwave in its dashboard.",
        "provider_not_supported",
      );
    }

    const transaction = await verifyTransaction(payment.provider_reference);
    const expectedCents = Math.round(Number(payment.amount_usd) * 100);

    if (transaction.status !== "success") {
      return json(req, {
        paymentStatus: payment.status,
        providerStatus: transaction.status,
        changed: false,
      });
    }
    if (transaction.amount !== expectedCents || transaction.currency !== "USD") {
      await db
        .from("payments")
        .update({ status: "failed", failure_reason: "Amount or currency did not match the order." })
        .eq("id", payment.id)
        .neq("status", "succeeded");
      return json(req, {
        paymentStatus: "failed",
        providerStatus: transaction.status,
        changed: false,
        reason: "amount_mismatch",
      });
    }

    const { data: updated, error: updateError } = await db
      .from("payments")
      .update({
        status: "succeeded",
        verified_at: new Date().toISOString(),
        provider_amount: transaction.amount / 100,
        provider_currency: transaction.currency,
        raw_payload: transaction as unknown as Record<string, unknown>,
      })
      .eq("id", payment.id)
      .neq("status", "succeeded")
      .select("id");

    if (updateError) {
      console.error("Payment update failed", updateError);
      throw new HttpError(500, "Could not record the verification.", "payment_update_failed");
    }

    if (updated && updated.length > 0) {
      await db
        .from("orders")
        .update({
          status: "paid",
          paid_at: transaction.paidAt ? new Date(transaction.paidAt).toISOString() : new Date().toISOString(),
        })
        .eq("id", payment.order_id)
        .eq("status", "pending_payment");
    }

    return json(req, {
      paymentStatus: "succeeded",
      providerStatus: transaction.status,
      changed: Boolean(updated && updated.length > 0),
    });
  } catch (error) {
    return fail(req, error);
  }
});
