import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "malvisdabz@gmail.com").trim().toLowerCase();
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const headers = { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"Content-Type, Authorization", "Access-Control-Allow-Methods":"POST, OPTIONS" };
const json = (body, status=200) => new Response(JSON.stringify(body), { status, headers:{...headers,"Content-Type":"application/json"} });

async function requireAdmin(req){
  const auth = req.headers.get("authorization");
  if(!auth?.startsWith("Bearer ")) return null;
  const {data,error} = await supabase.auth.getUser(auth.slice(7));
  if(error || !data?.user) return null;
  return String(data.user.email || "").trim().toLowerCase() === ADMIN_EMAIL ? data.user : null;
}

async function addHistory(orderId, status, actorId, note){
  await supabase.from("order_status_history").insert({order_id:orderId,status,actor_id:actorId,note});
}

async function notify(recipientId, orderId, title, message){
  if(!recipientId) return;
  await supabase.from("order_notifications").insert({recipient_id:recipientId,order_id:orderId,sender_id:null,title,message,notification_type:"order"});
  try{
    const {sendSalgaPush} = await import("./push.mjs");
    await sendSalgaPush(recipientId,{title,message,orderId,type:"order"});
  }catch(e){ console.error("SALGA PUSH ERROR",e?.message||e); }
}

export default async function handler(req){
  if(req.method === "OPTIONS") return new Response("ok",{headers});
  if(req.method !== "POST") return json({error:"Method not allowed"},405);
  if(!SUPABASE_URL || !SUPABASE_KEY) return json({error:"Supabase server configuration is missing."},500);
  try{
    const admin = await requireAdmin(req);
    if(!admin) return json({error:"Admin authorization required."},403);
    const body = await req.json().catch(()=>({}));
    const action = String(body.action || "");
    if(action !== "cancel_order") return json({error:"Unsupported admin order action."},400);
    const orderId = String(body.order_id || "").trim();
    if(!orderId) return json({error:"Order ID is required."},400);

    const {data:o,error:oe} = await supabase.from("orders")
      .select("id,buyer_id,business_id,status,payment_status,order_items(product_id),businesses(owner_id,business_name)")
      .eq("id",orderId).maybeSingle();
    if(oe) throw oe;
    if(!o) return json({error:"Order not found."},404);
    if(o.status === "completed" || o.status === "cancelled") return json({error:"This order is already closed."},400);
    if(o.payment_status === "paid") return json({error:"Paid orders cannot be cancelled by this action because a refund must be handled safely before the order is closed."},400);

    const now = new Date().toISOString();
    const productId = o.order_items?.[0]?.product_id;
    if(productId){
      await supabase.from("products").update({reserved_order_id:null,reserved_at:null,updated_at:now}).eq("id",productId).eq("reserved_order_id",orderId);
    }

    const {data:updated,error:ue} = await supabase.from("orders").update({status:"cancelled",cancelled_at:now,updated_at:now,notes:`Cancelled by SALGA admin${body.reason ? `: ${String(body.reason).trim().slice(0,300)}` : "."}`}).eq("id",orderId).select("*").single();
    if(ue) throw ue;

    await addHistory(orderId,"cancelled",admin.id,`Order cancelled by SALGA admin${body.reason ? `: ${String(body.reason).trim().slice(0,300)}` : "."}`);
    const businessName = o.businesses?.business_name || "the business";
    await notify(o.buyer_id,orderId,"Order cancelled by SALGA",`Your order has been cancelled by SALGA administration. The reserved product has been released. Business: ${businessName}.`);
    await notify(o.businesses?.owner_id,orderId,"Order cancelled by SALGA",`Order ${orderId} was cancelled by SALGA administration. The reserved product has been released.`);

    return json({success:true,order:updated,message:"Order cancelled and the product reservation has been released."});
  }catch(error){
    console.error("ADMIN ORDER ACTION ERROR",error);
    return json({error:error instanceof Error ? error.message : "Admin order action failed."},500);
  }
}

export const config = { path: "/api/admin-order-actions" };
