/**
 * Flutterwave helpers — the alternative provider to Paystack.
 *
 * The verif-hash header is compared against FLUTTERWAVE_SECRET_HASH, and every
 * webhook is re-verified against the API before an order is marked paid.
 */
import { HttpError } from "./http.ts";

const API = "https://api.flutterwave.com/v3";

function secretKey(): string {
  const key = Deno.env.get("FLUTTERWAVE_SECRET_KEY");
  if (!key) {
    throw new HttpError(
      503,
      "Flutterwave payments are not configured yet, so no payment can be taken.",
      "payments_not_configured",
    );
  }
  return key;
}

export function flutterwaveConfigured(): boolean {
  return Boolean(Deno.env.get("FLUTTERWAVE_SECRET_KEY") && Deno.env.get("FLUTTERWAVE_SECRET_HASH"));
}

export async function initialisePayment(options: {
  email: string;
  amountUsd: number;
  reference: string;
  orderNumber: string;
  name: string;
  redirectUrl?: string;
  title?: string;
}): Promise<string> {
  const response = await fetch(`${API}/payments`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${secretKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tx_ref: options.reference,
      amount: options.amountUsd,
      currency: "USD",
      redirect_url: options.redirectUrl || undefined,
      customer: { email: options.email, name: options.name },
      customizations: {
        title: options.title ?? "MORGGY",
        description: `Order ${options.orderNumber}`,
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.status !== "success" || !payload?.data?.link) {
    console.error("Flutterwave init failed", response.status, payload?.message);
    throw new HttpError(502, "The payment provider did not accept that request.", "payment_provider_error");
  }
  return String(payload.data.link);
}

export type VerifiedFlutterwavePayment = {
  status: string;
  amount: number;
  currency: string;
  txRef: string;
};

export async function verifyPayment(transactionId: string): Promise<VerifiedFlutterwavePayment> {
  const response = await fetch(`${API}/transactions/${encodeURIComponent(transactionId)}/verify`, {
    headers: { "Authorization": `Bearer ${secretKey()}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.status !== "success") {
    throw new HttpError(502, "The payment could not be verified with Flutterwave.", "payment_provider_error");
  }
  const data = (payload.data ?? {}) as Record<string, unknown>;
  return {
    status: String(data.status ?? "unknown"),
    amount: Number(data.amount ?? 0),
    currency: String(data.currency ?? "").toUpperCase(),
    txRef: String(data.tx_ref ?? ""),
  };
}

export function verifyWebhookHash(header: string | null): boolean {
  const expected = Deno.env.get("FLUTTERWAVE_SECRET_HASH");
  if (!expected || !header) return false;
  if (header.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}
