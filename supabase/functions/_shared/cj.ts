/**
 * CJdropshipping client.
 *
 * CJ v2 issues a short-lived access token from the API key. The token is cached
 * for the lifetime of the function instance. All calls fail closed with a clear
 * 503 when credentials are missing, so nothing pretends to be integrated.
 */
import { HttpError } from "./http.ts";

type Token = { value: string; expiresAt: number };
let cachedToken: Token | null = null;

function base(): string {
  return Deno.env.get("CJ_API_BASE") ?? "https://developers.cjdropshipping.com/api2.0/v1";
}

export function cjConfigured(): boolean {
  return Boolean(Deno.env.get("CJ_API_KEY") && Deno.env.get("CJ_API_EMAIL"));
}

function requireCredentials(): void {
  if (!cjConfigured()) {
    throw new HttpError(
      503,
      "CJdropshipping is not connected yet: no API credentials are configured.",
      "supplier_not_configured",
    );
  }
}

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }

  requireCredentials();
  const response = await fetch(`${base()}/authentication/getAccessToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: Deno.env.get("CJ_API_EMAIL"),
      password: Deno.env.get("CJ_API_KEY"),
    }),
  });

  const payload = await response.json().catch(() => ({}));
  const token = payload?.data?.accessToken;
  if (!response.ok || !token) {
    console.error("CJ authentication failed", response.status, payload?.message);
    throw new HttpError(502, "CJdropshipping rejected the API credentials.", "supplier_auth_failed");
  }

  const expiry = Date.parse(String(payload?.data?.accessTokenExpiryDate ?? "")) || Date.now() + 3_600_000;
  cachedToken = { value: String(token), expiresAt: expiry };
  return cachedToken.value;
}

export async function cjRequest(
  path: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  const token = await accessToken();
  const response = await fetch(`${base()}${path}`, {
    ...init,
    headers: {
      "CJ-Access-Token": token,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.result === false || (payload?.code && Number(payload.code) !== 200)) {
    console.error("CJ request failed", path, response.status, payload?.message);
    throw new HttpError(
      502,
      `CJdropshipping rejected the request: ${payload?.message ?? response.status}`,
      "supplier_error",
    );
  }
  return payload as Record<string, unknown>;
}

export async function getProduct(supplierProductId: string): Promise<Record<string, unknown>> {
  const payload = await cjRequest(`/product/query?pid=${encodeURIComponent(supplierProductId)}`);
  return (payload.data ?? {}) as Record<string, unknown>;
}

export async function freightEstimate(options: {
  destinationCountry: string;
  supplierProductId: string;
  quantity: number;
}): Promise<Record<string, unknown>[]> {
  const payload = await cjRequest("/logistic/freightCalculate", {
    method: "POST",
    body: JSON.stringify({
      startCountryCode: "CN",
      endCountryCode: options.destinationCountry,
      products: [{ quantity: options.quantity, vid: options.supplierProductId }],
    }),
  });
  const data = payload.data;
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

export async function createSupplierOrder(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const payload = await cjRequest("/shopping/order/createOrderV2", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return (payload.data ?? {}) as Record<string, unknown>;
}

export async function getSupplierOrder(supplierOrderId: string): Promise<Record<string, unknown>> {
  const payload = await cjRequest(
    `/shopping/order/getOrderDetail?orderId=${encodeURIComponent(supplierOrderId)}`,
  );
  return (payload.data ?? {}) as Record<string, unknown>;
}
