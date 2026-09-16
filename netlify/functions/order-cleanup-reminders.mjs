import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const TERMINAL = ["cancelled", "unsuccessful", "failed", "rejected"];

export default async function handler() {
  if (!url || !key) throw new Error("Supabase server configuration is missing.");
  const now = Date.now();
  const lower = new Date(now - 23 * 60 * 60 * 1000).toISOString();
  const upper = new Date(now - 22 * 60 * 60 * 1000).toISOString();

  const { data: orders, error } = await supabase
    .from("orders")
    .select("id,buyer_id,business_id,status,updated_at")
    .in("status", TERMINAL)
    .gte("updated_at", lower)
    .lt("updated_at", upper)
    .limit(200);
  if (error) throw error;

  let reminded = 0;
  for (const order of orders || []) {
    const { data: already } = await supabase
      .from("order_notifications")
      .select("id")
      .eq("order_id", order.id)
      .eq("notification_type", "cleanup_warning")
      .limit(1);

    if (already?.length) continue;

    const recipients = [order.buyer_id];
    const { data: business } = await supabase
      .from("businesses")
      .select("owner_id")
      .eq("id", order.business_id)
      .maybeSingle();
    if (business?.owner_id) recipients.push(business.owner_id);

    const uniqueRecipients = [...new Set(recipients.filter(Boolean))];
    if (!uniqueRecipients.length) continue;

    const rows = uniqueRecipients.map(recipient_id => ({
      order_id: order.id,
      recipient_id,
      sender_id: null,
      notification_type: "cleanup_warning",
      title: "Order record reminder",
      message: "This unsuccessful/cancelled order record will be removed automatically after 24 hours. If you need to review it, please do so before the retention period ends."
    }));

    const { error: insertError } = await supabase.from("order_notifications").insert(rows);
    if (insertError) {
      console.error("ORDER CLEANUP REMINDER FAILED", order.id, insertError.message);
      continue;
    }
    reminded++;
  }

  return new Response(JSON.stringify({ success: true, reminded, window: "23-22 hours before cleanup" }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

export const config = { schedule: "0 * * * *" };
