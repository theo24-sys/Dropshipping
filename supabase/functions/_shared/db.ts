/**
 * Supabase clients.
 *
 * `serviceClient()` bypasses RLS and must never be handed to a browser.
 * `callerFrom()` resolves the signed-in user from the Authorization header so a
 * function can act on their behalf (or check that they are staff).
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { HttpError } from "./http.ts";

let cachedService: SupabaseClient | null = null;

export function serviceClient(): SupabaseClient {
  if (cachedService) return cachedService;

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new HttpError(500, "Server is not configured.", "missing_service_credentials");
  }
  cachedService = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "X-Client-Info": "morggy-edge-functions" } },
  });
  return cachedService;
}

export type Caller = {
  id: string;
  email: string;
  role: "customer" | "staff" | "admin";
};

export async function callerFrom(req: Request): Promise<Caller | null> {
  const header = req.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return null;

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) return null;

  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: header } },
  });

  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;

  const { data: profile } = await serviceClient()
    .from("profiles")
    .select("id, email, role")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!profile) return null;

  return {
    id: profile.id,
    email: profile.email ?? data.user.email ?? "",
    role: (profile.role ?? "customer") as Caller["role"],
  };
}

export async function requireStaff(req: Request): Promise<Caller> {
  const caller = await callerFrom(req);
  if (!caller) {
    throw new HttpError(401, "Sign in to continue.", "unauthorised");
  }
  if (caller.role !== "staff" && caller.role !== "admin") {
    throw new HttpError(403, "This action is limited to staff.", "forbidden");
  }
  return caller;
}
