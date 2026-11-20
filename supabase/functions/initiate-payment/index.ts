/**
 * POST /functions/v1/initiate-payment
 *
 * Body: { orderNumber, email, provider? }
 *
 * Creates a gateway checkout session for an order that is still awaiting
 * payment. The amount comes from the order row, not from the request. A
 * customer can only start payment for their own order (matching email or
 * matching signed-in user).
 *
 * Nothing here marks an order as paid: only the signed webhook does that.
 */
import { HttpError, fail, json, preflight, readJson, requirePost } from "../_shared/http.ts";
import { callerFrom, serviceClient } from "../_shared/db.ts";
import { initialisePayment as initialiseFlutterwave, flutterwaveConfigured } from "../_shared/flutterwave.ts";
import { initialiseTransaction, paymentsConfigured } from "../_shared/paystack.ts";
import { asEmail, asText, money } from "../_shared/validate.ts";

const PROVIDERS = ["paystack", "flutterwave"];

function reference(orderNumber: string): string {
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
  return `${orderNumber}-${suffix}`;
}

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;

  try {
    requirePost(req);
    const body = await readJson(req);

    const orderNumber = asText(body.orderNumber, "order number", 6, 40);
    const email = asEmail(body.email);
    const provider = String(body.provider ?? "paystack").toLowerCase();

    if (!PROVIDERS.includes(provider)) {
      throw new HttpError(400, "Choose a supported payment method.", "invalid_provider");
    }

    const db = serviceClient();
    const { data: order, error } = await db
      .from("orders")
      .select("id, order_number, email, full_name, total_usd, status, market, user_id")
      .eq("order_number", orderNumber)
      .maybeSingle();

    if (error) {
      console.error("Order lookup failed", error);
      throw new HttpError(500, "We could not load that order. Please try again.", "order_lookup_failed");
    }

    // Same response for "not found" and "not yours" so order numbers cannot be
    // probed from the outside.
    const caller = await callerFrom(req);
    const ownsByEmail = order ? order.email.toLowerCase() === email : false;
    const ownsByUser = Boolean(order?.user_id && caller?.id === order.user_id);

    if (!order || (!ownsByEmail && !ownsByUser)) {
      throw new HttpError(404, "We could not find that order.", "order_not_found");
    }
    if (order.status !== "pending_payment") {
      throw new HttpError(
        409,
        "This order is not awaiting payment.",
        "order_not_payable",
      );
    }

    const amount = money(Number(order.total_usd));
    const paymentReference = reference(order.order_number);
    const callbackUrl = Deno.env.get("PAYMENT_CALLBACK_URL") || undefined;

    let authorizationUrl: string;

    if (provider === "paystack") {
      if (!paymentsConfigured()) {
        throw new HttpError(
          503,
          "Card payments are not configured yet. No payment was taken.",
          "payments_not_configured",
        );
      }
      const transaction = await initialiseTransaction({
        email,
        amountUsd: amount,
        reference: paymentReference,
        orderNumber: order.order_number,
        callbackUrl,
      });
      authorizationUrl = transaction.authorizationUrl;
    } else {
      if (!flutterwaveConfigured()) {
        throw new HttpError(
          503,
          "Flutterwave payments are not configured yet. No payment was taken.",
          "payments_not_configured",
        );
      }
      authorizationUrl = await initialiseFlutterwave({
        email,
        amountUsd: amount,
        reference: paymentReference,
        orderNumber: order.order_number,
        name: order.full_name ?? "",
        redirectUrl: callbackUrl,
      });
    }

    const { error: paymentError } = await db.from("payments").insert({
      order_id: order.id,
      provider,
      provider_reference: paymentReference,
      amount_usd: amount,
      provider_currency: "USD",
      status: "pending",
      authorization_url: authorizationUrl,
    });

    if (paymentError) {
      // The gateway link exists but we could not record it: do not hand the
      // customer a link we have no record of.
      console.error("Payment record insert failed", paymentError);
      throw new HttpError(
        500,
        "We could not start the payment. Nothing has been charged.",
        "payment_record_failed",
      );
    }

    return json(req, {
      orderNumber: order.order_number,
      provider,
      reference: paymentReference,
      authorizationUrl,
      amountUsd: amount,
      charged: false,
    });
  } catch (error) {
    return fail(req, error);
  }
});
