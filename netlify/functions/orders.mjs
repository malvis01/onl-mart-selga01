import { createClient } from "@supabase/supabase-js";
import paymentHandler from "./payments.mjs";

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json"
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });

async function getUser(req) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  const { data, error } = await supabase.auth.getUser(token);
  return error || !data?.user ? null : data.user;
}

async function getOrders(req) {
  const user = await getUser(req);
  if (!user) return json({ error: "Login required" }, 401);

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, phone, full_name")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) return json({ error: "User profile not found" }, 404);

  if (profile.role === "buyer") {
    const { data, error } = await supabase
      .from("orders")
      .select(`id,buyer_id,business_id,total_amount,delivery_fee,status,payment_status,notes,created_at,updated_at,businesses(id,business_name,logo_url),order_items(id,product_id,quantity,unit_price,products(id,name,image_url))`)
      .eq("buyer_id", user.id)
      .order("created_at", { ascending: false });
    if (error) return json({ error: error.message }, 500);
    return json({ orders: data || [] });
  }

  if (profile.role === "seller" || profile.role === "business_owner") {
    const { data: businesses, error: businessError } = await supabase
      .from("businesses")
      .select("id")
      .eq("owner_id", user.id);
    if (businessError) return json({ error: businessError.message }, 500);

    const ids = (businesses || []).map(b => b.id);
    if (!ids.length) return json({ orders: [] });

    const { data, error } = await supabase
      .from("orders")
      .select(`id,buyer_id,business_id,total_amount,delivery_fee,status,payment_status,notes,created_at,updated_at,businesses(id,business_name,logo_url),order_items(id,product_id,quantity,unit_price,products(id,name,image_url))`)
      .in("business_id", ids)
      .order("created_at", { ascending: false });
    if (error) return json({ error: error.message }, 500);
    return json({ orders: data || [] });
  }

  return json({ error: "Unsupported account role" }, 403);
}

export default async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers });

    if (req.method === "GET") {
      return await getOrders(req);
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const productId = body.productId || body.product_id;

      if (!productId) {
        return json({ error: "Product ID is required." }, 400);
      }

      /*
       * The Buy now button uses /api/orders, while the secure
       * Paystack flow lives in /api/payments. Delegate the purchase
       * here so the button creates the order, payment record and
       * Paystack checkout in one trusted server-side flow.
       */
      const paymentRequest = new Request(req.url, {
        method: "POST",
        headers: req.headers,
        body: JSON.stringify({
          ...body,
          productId,
          quantity: Math.max(1, Number(body.quantity || 1))
        })
      });

      return await paymentHandler(paymentRequest);
    }

    return json({ error: "Method not allowed", allowed_methods: ["GET", "POST", "OPTIONS"] }, 405);
  } catch (error) {
    console.error("ORDERS FUNCTION ERROR", error);
    return json({ error: error?.message || "Unable to process order." }, 500);
  }
};

export const config = { path: "/api/orders" };
