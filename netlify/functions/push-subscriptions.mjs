import { createClient } from "@supabase/supabase-js";
import { PUBLIC_KEY, pushConfigured } from "./push.mjs";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS"
};
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...headers, "Content-Type": "application/json" }
});

async function user(req) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const { data, error } = await supabase.auth.getUser(auth.slice(7));
  return error || !data?.user ? null : data.user;
}

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method === "GET") return json({ configured: pushConfigured(), publicKey: PUBLIC_KEY || null });

  const u = await user(req);
  if (!u) return json({ error: "Login required" }, 401);
  if (!pushConfigured()) return json({ configured: false, error: "Web Push is not configured yet." }, 503);

  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const s = body.subscription || body;
      if (!s?.endpoint || !s?.keys?.p256dh || !s?.keys?.auth) {
        return json({ error: "Invalid push subscription." }, 400);
      }
      const { error } = await supabase.from("push_subscriptions").upsert({
        user_id: u.id,
        endpoint: String(s.endpoint),
        p256dh: String(s.keys.p256dh),
        auth: String(s.keys.auth),
        expiration_time: s.expirationTime == null ? null : Number(s.expirationTime),
        user_agent: req.headers.get("user-agent") || null,
        updated_at: new Date().toISOString()
      }, { onConflict: "user_id,endpoint" });
      if (error) throw error;
      return json({ success: true });
    }

    if (req.method === "DELETE") {
      const body = await req.json().catch(() => ({}));
      const endpoint = String(body.endpoint || "").trim();
      if (!endpoint) return json({ error: "Subscription endpoint is required." }, 400);
      const { error } = await supabase.from("push_subscriptions").delete().eq("user_id", u.id).eq("endpoint", endpoint);
      if (error) throw error;
      return json({ success: true });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (error) {
    console.error("SALGA PUSH SUBSCRIPTION ERROR", error);
    return json({ error: error?.message || "Push subscription failed." }, 500);
  }
}

export const config = { path: "/api/push-subscriptions" };
