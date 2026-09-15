import { createClient } from "@supabase/supabase-js";
import { sendSalgaPush, pushConfigured } from "./push.mjs";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler() {
  if (!pushConfigured()) return new Response(JSON.stringify({ skipped: true, reason: "Web Push not configured" }), { status: 200 });

  const { data: notifications, error } = await supabase
    .from("order_notifications")
    .select("id,recipient_id,order_id,title,message,notification_type,created_at")
    .is("push_sent_at", null)
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) throw error;

  let sent = 0;
  for (const notification of notifications || []) {
    try {
      await sendSalgaPush(notification.recipient_id, {
        title: notification.title || "SALGA Digital Mart",
        body: notification.message || "You have a new SALGA update.",
        orderId: notification.order_id || null,
        tag: notification.order_id ? `salga-order-${notification.order_id}` : `salga-notification-${notification.id}`,
        url: notification.order_id ? "/#account" : "/"
      });
      await supabase.from("order_notifications").update({ push_sent_at: new Date().toISOString() }).eq("id", notification.id).is("push_sent_at", null);
      sent += 1;
    } catch (error) {
      console.error("SALGA PUSH DISPATCH", notification.id, error?.message || error);
    }
  }

  return new Response(JSON.stringify({ success: true, processed: notifications?.length || 0, sent }), { status: 200, headers: { "Content-Type": "application/json" } });
}

export const config = { schedule: "* * * * *" };
