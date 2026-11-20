/**
 * Shared HTTP helpers for MORGGY Edge Functions.
 *
 * CORS is an explicit allowlist from ALLOWED_ORIGINS. A request from an origin
 * that is not listed still runs, but the browser is not given permission to
 * read the response — which is the behaviour we want for a public endpoint.
 */

export class HttpError extends Error {
  status: number;
  code: string;

  constructor(status: number, message: string, code = "error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function allowedOrigins(): string[] {
  return (Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allowed = allowedOrigins();
  const headers: Record<string, string> = {
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Max-Age": "86400",
  };
  if (origin && allowed.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export function fail(req: Request, error: unknown): Response {
  if (error instanceof HttpError) {
    return json(req, { error: error.message, code: error.code }, error.status);
  }
  console.error("Unhandled function error", error);
  return json(req, { error: "Something went wrong. Please try again.", code: "internal" }, 500);
}

export function preflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  return null;
}

export function requirePost(req: Request): void {
  if (req.method !== "POST") {
    throw new HttpError(405, "Method not allowed.", "method_not_allowed");
  }
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) {
    throw new HttpError(415, "Expected a JSON body.", "unsupported_media_type");
  }
  const length = Number(req.headers.get("content-length") ?? "0");
  if (length > 64_000) {
    throw new HttpError(413, "Request body is too large.", "payload_too_large");
  }
  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "Expected a JSON object.", "invalid_body");
    }
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "The request body is not valid JSON.", "invalid_json");
  }
}
