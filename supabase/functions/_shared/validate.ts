/**
 * Small, dependency-free validators. Every rule here mirrors a constraint in the
 * database; the database remains the final authority.
 */
import { HttpError } from "./http.ts";
import { MARKET_CODES, isLiveMarket } from "./markets.ts";

export const MAX_ITEMS = 20;
export const MAX_QUANTITY = 20;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

export function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function asUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw new HttpError(400, `“${field}” must be a valid id.`, "invalid_field");
  }
  return value;
}

export function asText(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== "string") {
    throw new HttpError(400, `“${field}” is required.`, "invalid_field");
  }
  const text = value.trim();
  if (text.length < min || text.length > max) {
    throw new HttpError(
      400,
      `“${field}” must be between ${min} and ${max} characters.`,
      "invalid_field",
    );
  }
  return text;
}

export function optionalText(value: unknown, field: string, max: number): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") {
    throw new HttpError(400, `“${field}” must be text.`, "invalid_field");
  }
  const text = value.trim();
  if (text.length > max) {
    throw new HttpError(400, `“${field}” is too long.`, "invalid_field");
  }
  return text;
}

export function asEmail(value: unknown): string {
  if (typeof value !== "string" || !EMAIL_RE.test(value.trim())) {
    throw new HttpError(400, "Enter a valid email address.", "invalid_email");
  }
  return value.trim().toLowerCase();
}

export function asMarket(value: unknown): string {
  if (typeof value !== "string" || !MARKET_CODES.includes(value)) {
    throw new HttpError(400, "Choose a supported delivery country.", "invalid_market");
  }
  if (!isLiveMarket(value)) {
    throw new HttpError(
      400,
      "We do not accept orders for that country yet.",
      "market_not_open",
    );
  }
  return value;
}

export function asQuantity(value: unknown): number {
  const quantity = Number(value);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
    throw new HttpError(
      400,
      `Quantity must be a whole number from 1 to ${MAX_QUANTITY}.`,
      "invalid_quantity",
    );
  }
  return quantity;
}

export function asPhone(value: unknown): string {
  if (typeof value !== "string") {
    throw new HttpError(400, "Enter a mobile number for delivery updates.", "invalid_phone");
  }
  const phone = value.trim();
  if (!/^\+?[0-9 ()-]{7,20}$/.test(phone)) {
    throw new HttpError(400, "Enter a valid mobile number.", "invalid_phone");
  }
  return phone;
}

export type ShippingAddress = {
  line1: string;
  line2: string;
  city: string;
  postcode: string;
  state: string;
};

export function asAddress(value: unknown, market: string): ShippingAddress {
  if (!value || typeof value !== "object") {
    throw new HttpError(400, "A delivery address is required.", "invalid_address");
  }
  const raw = value as Record<string, unknown>;
  const line1 = asText(raw.line1, "address line 1", 3, 160);
  const line2 = optionalText(raw.line2, "address line 2", 160);
  const city = optionalText(raw.city, "city", 80);
  const postcode = asText(raw.postcode, "postcode", 4, 10);
  const state = optionalText(raw.state, "state", 80);

  if (!/^[0-9]{5,6}$/.test(postcode)) {
    throw new HttpError(400, "Enter a valid postcode.", "invalid_postcode");
  }
  if (market === "MY" && !state) {
    throw new HttpError(400, "Choose a state for delivery in Malaysia.", "invalid_state");
  }
  if (market === "SG" && postcode.length !== 6) {
    throw new HttpError(400, "Singapore postcodes are six digits.", "invalid_postcode");
  }

  return { line1, line2, city, postcode, state };
}
