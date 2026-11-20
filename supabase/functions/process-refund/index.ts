/**
 * POST /functions/v1/process-refund  (staff only)
 *
 * Body: { refundId }
 *
 * A refund row is created by staff in the dashboard (RLS allows staff writes).
 * This function asks the provider to actually return the money. It refuses
 * anything that is not backed by a captured payment, and it never refunds more
 * than the payment captured.
 */
import { HttpError, fail, json, preflight, readJson, requirePost } from "../_shared/http.ts";
import { requireStaff, serviceClient } from "../_shared/db.ts";
import { refundTransaction } from "../_shared/paystack.ts";
import { asUuid } from "../_shared/validate.ts";

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;

  try {
    requirePost(req);
    const staff = await requireStaff(req);
    const body = await readJson(req);
    const refundId = asUuid(body.refundId, "refundId");

    const db = serviceClient();
    const { data: refund, error } = await db
      .from("refunds")
      .select("id, order_id, payment_id, amount_usd, status, provider_refund_reference")
      .eq("id", refundId)
      .maybeSingle();

    if (error) {
      console.error("Refund lookup failed", error);
      throw new HttpError(500, "Could not load that refund.", "refund_lookup_failed");
    }
    if (!refund) throw new HttpError(404, "Refund not found.", "refund_not_found");
    if (!["requested", "approved", "failed"].includes(refund.status)) {
      throw new HttpError(409, `This refund is already ${refund.status}.`, "refund_not_actionable");
    }

    const { data: payment, error: paymentError } = await db
      .from("payments")
      .select("id, provider, provider_reference, amount_usd, status")
      .eq("order_id", refund.order_id)
      .eq("status", "succeeded")
      .order("verified_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (paymentError) {
      console.error("Payment lookup failed for refund", paymentError);
      throw new HttpError(500, "Could not load the payment for that order.", "payment_lookup_failed");
    }
    if (!payment) {
      throw new HttpError(
        409,
        "No captured payment exists for this order, so there is nothing to refund through a gateway.",
        "no_captured_payment",
      );
    }
    if (Number(refund.amount_usd) > Number(payment.amount_usd) + 0.001) {
      throw new HttpError(400, "A refund cannot be larger than the captured payment.", "refund_too_large");
    }

    if (payment.provider !== "paystack") {
      throw new HttpError(
        501,
        "Flutterwave refunds must be issued in the Flutterwave dashboard; record the reference here afterwards.",
        "provider_not_supported",
      );
    }

    const providerRefundId = await refundTransaction({
      reference: String(payment.provider_reference),
      amountUsd: Number(refund.amount_usd),
    });

    const { error: updateError } = await db
      .from("refunds")
      .update({
        status: "processing",
        provider_refund_reference: providerRefundId ?? refund.provider_refund_reference,
        processed_by: staff.id,
      })
      .eq("id", refund.id);

    if (updateError) {
      console.error("Refund update failed", updateError);
      throw new HttpError(500, "The refund was sent but could not be recorded.", "refund_update_failed");
    }

    // A full refund closes the order; a partial one leaves it as it was.
    const isFull = Math.abs(Number(refund.amount_usd) - Number(payment.amount_usd)) < 0.01;
    if (isFull) {
      await db.from("orders").update({ status: "refunded" }).eq("id", refund.order_id);
      await db.from("payments").update({ status: "refunded" }).eq("id", payment.id);
    } else {
      await db.from("payments").update({ status: "partially_refunded" }).eq("id", payment.id);
    }

    return json(req, {
      refundId: refund.id,
      status: "processing",
      providerRefundId,
      note: "The provider confirms completion by webhook; the refund then shows as completed.",
    });
  } catch (error) {
    return fail(req, error);
  }
});
