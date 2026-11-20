/**
 * Paystack helpers. The secret key never leaves the Edge Function.
 *
 * Amounts: Paystack expects the smallest currency unit. We charge in USD, so the
 * amount is cents (total * 100).
 */
import { HttpError } from "./http.ts";

const API = "https://api.paystack.co";

function secretKey(): string {
  const key = Deno.env.get("PAYSTACK_SECRET_KEY");
  if (!key) {
    throw new HttpError(
      503,
      "Card payments are not configured yet, so no payment can be taken.",
      "payments_not_configured",
    );
  }
  return key;
}

export function paymentsConfigured(): boolean {
  return Boolean(Deno.env.get("PAYSTACK_SECRET_KEY"));
}

async function paystackFetch(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "Authorization": `Bearer ${secretKey()}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.status === false) {
    console.error("Paystack request failed", path, response.status, payload?.message);
    throw new HttpError(
      502,
      "The payment provider did not accept that request. No money has been taken.",
      "payment_provider_error",
    );
  }
  return payload as Record<string, unknown>;
}

export type InitialisedTransaction = {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
};

export async function initialiseTransaction(options: {
  email: string;
  amountUsd: number;
  reference: string;
  orderNumber: string;
  callbackUrl?: string;
}): Promise<InitialisedTransaction> {
  const body: Record<string, unknown> = {
    email: options.email,
    amount: Math.round(options.amountUsd * 100),
    currency: "USD",
    reference: options.reference,
    metadata: { order_number: options.orderNumber, source: "morggy-storefront" },
  };
  if (options.callbackUrl) body.callback_url = options.callbackUrl;

  const payload = await paystackFetch("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify(body),
  });

  const data = (payload.data ?? {}) as Record<string, unknown>;
  if (!data.authorization_url) {
    throw new HttpError(502, "The payment provider returned no checkout link.", "payment_provider_error");
  }
  return {
    authorizationUrl: String(data.authorization_url),
    accessCode: String(data.access_code ?? ""),
    reference: String(data.reference ?? options.reference),
  };
}

export type VerifiedTransaction = {
  status: string;
  amount: number; // smallest currency unit
  currency: string;
  reference: string;
  paidAt: string | null;
};

export async function verifyTransaction(reference: string): Promise<VerifiedTransaction> {
  const payload = await paystackFetch(`/transaction/verify/${encodeURIComponent(reference)}`);
  const data = (payload.data ?? {}) as Record<string, unknown>;
  return {
    status: String(data.status ?? "unknown"),
    amount: Number(data.amount ?? 0),
    currency: String(data.currency ?? "").toUpperCase(),
    reference: String(data.reference ?? reference),
    paidAt: data.paid_at ? String(data.paid_at) : null,
  };
}

export async function refundTransaction(options: {
  reference: string;
  amountUsd: number;
}): Promise<string | null> {
  const payload = await paystackFetch("/refund", {
    method: "POST",
    body: JSON.stringify({
      transaction: options.reference,
      amount: Math.round(options.amountUsd * 100),
      currency: "USD",
    }),
  });
  const data = (payload.data ?? {}) as Record<string, unknown>;
  return data.id ? String(data.id) : null;
}

/**
 * Verify the `x-paystack-signature` header: HMAC-SHA512 of the *raw* body,
 * keyed with the secret key, hex encoded. Comparison is constant time.
 */
export async function verifySignature(rawBody: string, signature: string | null): Promise<boolean> {
  if (!signature) return false;
  const key = Deno.env.get("PAYSTACK_SECRET_KEY");
  if (!key) return false;

  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(rawBody));
  const expected = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= expected.charCodeAt(i) ^ signature.toLowerCase().charCodeAt(i);
  }
  return mismatch === 0;
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
