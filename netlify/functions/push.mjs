import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

const env = (name) => process.env[name];
const SUPABASE_URL = env("SUPABASE_URL");
const SUPABASE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const PUBLIC_KEY = env("SALGA_VAPID_PUBLIC_KEY") || "";
const PRIVATE_KEY = env("SALGA_VAPID_PRIVATE_KEY") || "";
const SUBJECT = env("SALGA_VAPID_SUBJECT") || "mailto:admin@salgadigitalmart.com";

export function pushConfigured() {
  return Boolean(PUBLIC_KEY && PRIVATE_KEY);
}

function configure() {
  if (!pushConfigured()) return false;
  webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
  return true;
}

export async function sendSalgaPush(recipientId, payload) {
  if (!recipientId || !configure()) return { sent: 0, configured: false };

  const { data: rows, error } = await supabase
    .from("push_subscriptions")
    .select("id,endpoint,p256dh,auth,expiration_time")
    .eq("user_id", recipientId);
  if (error) throw error;

  let sent = 0;
  for (const row of rows || []) {
    const subscription = {
      endpoint: row.endpoint,
      expirationTime: row.expiration_time ?? null,
      keys: { p256dh: row.p256dh, auth: row.auth }
    };
    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 86400 });
      sent += 1;
    } catch (error) {
      const status = Number(error?.statusCode || 0);
      if (status === 404 || status === 410) {
        await supabase.from("push_subscriptions").delete().eq("id", row.id);
      } else {
        console.error("SALGA PUSH DELIVERY ERROR", status, error?.message || error);
      }
    }
  }
  return { sent, configured: true };
}

export async function unreadPushCount(recipientId) {
  const { count, error } = await supabase
    .from("order_notifications")
    .select("id", { count: "exact", head: true })
    .eq("recipient_id", recipientId)
    .eq("read", false);
  if (error) throw error;
  return Number(count || 0);
}

export { PUBLIC_KEY };
