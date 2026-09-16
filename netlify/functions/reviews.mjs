import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization" }
});

async function userFromRequest(req) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const { data, error } = await supabase.auth.getUser(auth.slice(7).trim());
  if (error || !data?.user) return null;
  return data.user;
}

export default async function handler(req) {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const user = await userFromRequest(req);
  if (!user) return json({ error: "Login required." }, 401);

  try {
    const body = await req.json();
    const orderId = String(body.order_id || "").trim();
    const rating = Number(body.rating);
    const review = String(body.review || "").trim().slice(0, 1000);

    if (!orderId || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      return json({ error: "A rating from 1 to 5 stars is required." }, 400);
    }

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id,buyer_id,business_id,status")
      .eq("id", orderId)
      .eq("buyer_id", user.id)
      .maybeSingle();

    if (orderError) throw orderError;
    if (!order) return json({ error: "Order not found or does not belong to you." }, 404);
    if (String(order.status || "").toLowerCase() !== "completed") {
      return json({ error: "You can rate a business only after the order is completed." }, 409);
    }

    const { data: existing, error: existingError } = await supabase
      .from("reviews")
      .select("id")
      .eq("order_id", orderId)
      .eq("reviewer_id", user.id)
      .maybeSingle();

    if (existingError) throw existingError;
    if (existing) return json({ error: "You have already rated this completed order." }, 409);

    const { data: created, error: insertError } = await supabase
      .from("reviews")
      .insert({
        reviewer_id: user.id,
        business_id: order.business_id,
        order_id: order.id,
        rating,
        review: review || null,
        approved: true
      })
      .select("id,business_id,order_id,rating,review,created_at")
      .single();

    if (insertError) throw insertError;
    return json({ success: true, review: created });
  } catch (error) {
    console.error("REVIEWS API:", error);
    return json({ error: error?.message || "Unable to save rating." }, 500);
  }
}
