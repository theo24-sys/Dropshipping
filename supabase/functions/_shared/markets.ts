/**
 * Server-side market table.
 *
 * The database is authoritative for prices and shipping (the `shipping_methods`
 * table). This list only decides which country codes exist and which are open,
 * so a request for Vietnam is rejected before it touches the database.
 */
export type MarketCode = "SG" | "MY" | "VN";

export const MARKET_CODES: string[] = ["SG", "MY", "VN"];

export const MARKETS: Record<MarketCode, { name: string; currency: string; status: "live" | "waitlist" }> = {
  SG: { name: "Singapore", currency: "SGD", status: "live" },
  MY: { name: "Malaysia", currency: "MYR", status: "live" },
  VN: { name: "Vietnam", currency: "VND", status: "waitlist" },
};

export function isLiveMarket(code: string): boolean {
  return MARKETS[code as MarketCode]?.status === "live";
}

export function currencyFor(code: string): string {
  return MARKETS[code as MarketCode]?.currency ?? "USD";
}
