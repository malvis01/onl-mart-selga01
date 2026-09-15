import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const headers = { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"Content-Type, Authorization", "Access-Control-Allow-Methods":"POST, OPTIONS" };
const json = (body, status=200) => new Response(JSON.stringify(body), { status, headers:{...headers,"Content-Type":"application/json"} });
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function user(req){
  const auth=req.headers.get("authorization");
  if(!auth?.startsWith("Bearer ")) return null;
  const {data,error}=await supabase.auth.getUser(auth.slice(7));
  return error || !data?.user ? null : data.user;
}

async function addHistory(orderId,status,actorId,note=null){
  await supabase.from("order_status_history").insert({order_id:orderId,status,actor_id:actorId,note});
}

async function sellerOwnsOrder(userId,orderId){
  const {data,error}=await supabase.from("orders").select("id,business_id,businesses!inner(owner_id)").eq("id",orderId).maybeSingle();
  if(error) throw error;
  if(!data || data.businesses?.owner_id!==userId) return null;
  return data;
}

export default async function handler(req){
  if(req.method==="OPTIONS") return new Response("ok",{headers});
  if(req.method!=="POST") return json({error:"Method not allowed"},405);
  try{
    const u=await user(req); if(!u) return json({error:"Login required"},401);
    const body=await req.json().catch(()=>({}));
    const action=String(body.action||"");

    if(action==="request_delivery_quote"){
      if(u.id!==body.buyer_id && body.buyer_id) return json({error:"Buyer authorization failed."},403);
      const productId=body.product_id||body.productId;
      const address=String(body.delivery_address||"").trim();
      if(!productId || !address) return json({error:"Your delivery address/location is required before the seller can set a delivery fee."},400);
      const {data:p,error:pe}=await supabase.from("products").select("id,business_id,name,price,stock,status,approved").eq("id",productId).eq("status","active").eq("approved",true).maybeSingle();
      if(pe) throw pe; if(!p) return json({error:"Product not found or unavailable."},404);
      if(Number(p.stock)!==1) return json({error:"This product is no longer available."},409);
      const {data:b,error:be}=await supabase.from("businesses").select("id,owner_id,business_name,status,location,address").eq("id",p.business_id).single();
      if(be) throw be; if(!b || b.status!=="active") return json({error:"This business is not currently active."},400);
      if(b.owner_id===u.id) return json({error:"You cannot purchase your own product."},400);
      const subtotal=Math.round(Number(p.price)*100)/100;
      const {data:order,error:oe}=await supabase.from("orders").insert({buyer_id:u.id,business_id:b.id,total_amount:subtotal,product_subtotal:subtotal,delivery_fee:0,delivery_address:address,delivery_lat:body.delivery_lat??null,delivery_lng:body.delivery_lng??null,status:"awaiting_delivery_fee",payment_status:"pending",notes:body.notes||null}).select("*").single();
      if(oe) throw oe;
      const {error:ie}=await supabase.from("order_items").insert({order_id:order.id,product_id:p.id,quantity:1,unit_price:subtotal});
      if(ie){await supabase.from("orders").delete().eq("id",order.id);throw ie;}
      await addHistory(order.id,"awaiting_delivery_fee",u.id,"Buyer submitted delivery location; seller must set delivery fee.");
      return json({success:true,order:{...order,product_name:p.name,business_name:b.business_name,delivery_fee:0},message:"Delivery location received. The business owner will set the delivery fee before payment."});
    }

    if(action==="seller_set_delivery_fee"){
      const orderId=body.order_id; const fee=Number(body.delivery_fee);
      if(!orderId || !Number.isFinite(fee) || fee<0) return json({error:"Enter a valid delivery fee."},400);
      const order=await sellerOwnsOrder(u.id,orderId); if(!order) return json({error:"Order not found or you are not the seller."},404);
      const {data:full,error:fe}=await supabase.from("orders").select("id,status,product_subtotal,total_amount,delivery_fee,delivery_address,buyer_id").eq("id",orderId).single();
      if(fe) throw fe; if(full.status!=="awaiting_delivery_fee") return json({error:"This order is not waiting for a delivery fee."},400);
      const total=Math.round((Number(full.product_subtotal||full.total_amount||0)+fee)*100)/100;
      const {data:updated,error:ue}=await supabase.from("orders").update({delivery_fee:fee,total_amount:total,status:"delivery_fee_set",delivery_fee_set_by:u.id,delivery_fee_set_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",orderId).select("*").single();
      if(ue) throw ue;
      await addHistory(orderId,"delivery_fee_set",u.id,`Seller set delivery fee to ₦${fee.toLocaleString("en-NG")}.`);
      return json({success:true,order:updated,message:"Delivery fee added. The customer can now pay."});
    }

    if(action==="seller_status"){
      const orderId=body.order_id, next=String(body.status||"");
      const allowed={confirmed:["processing"],processing:["dispatched"],dispatched:["in_transit","delivered"],in_transit:["delivered"]};
      if(!orderId || !allowed[next] && !Object.values(allowed).flat().includes(next)) return json({error:"Invalid order status."},400);
      const current=await sellerOwnsOrder(u.id,orderId); if(!current) return json({error:"Order not found or you are not the seller."},404);
      const {data:o,error:oe}=await supabase.from("orders").select("id,status,payment_status").eq("id",orderId).single(); if(oe) throw oe;
      if(o.payment_status!=="paid") return json({error:"The order must be paid before it can be processed."},400);
      if(!(allowed[o.status]||[]).includes(next)) return json({error:`This order cannot move from ${o.status} to ${next}.`},400);
      const patch={status:next,updated_at:new Date().toISOString()};
      if(next==="dispatched") patch.dispatched_at=new Date().toISOString();
      if(next==="delivered") patch.delivered_at=new Date().toISOString();
      const {data:updated,error:ue}=await supabase.from("orders").update(patch).eq("id",orderId).select("*").single(); if(ue) throw ue;
      await addHistory(orderId,next,u.id,null);
      return json({success:true,order:updated});
    }

    if(action==="buyer_received"){
      const orderId=body.order_id;
      if(!orderId) return json({error:"Order ID is required."},400);
      const {data:o,error:oe}=await supabase.from("orders").select("id,buyer_id,business_id,status,payment_status,product_subtotal,total_amount,delivery_fee,order_items(id,product_id,quantity,unit_price)").eq("id",orderId).maybeSingle(); if(oe) throw oe;
      if(!o || o.buyer_id!==u.id) return json({error:"Order not found."},404);
      if(o.payment_status!=="paid" || o.status!=="delivered") return json({error:"You can confirm receipt only after the seller marks the order delivered."},400);
      const {data:tx,error:te}=await supabase.from("transactions").select("*").eq("order_id",orderId).maybeSingle(); if(te) throw te;
      if(!tx) return json({error:"Transaction record was not found."},500);
      const now=new Date().toISOString();
      const {error:oe2}=await supabase.from("orders").update({status:"completed",received_at:now,updated_at:now}).eq("id",orderId); if(oe2) throw oe2;
      await supabase.from("transactions").update({status:"eligible",seller_available_at:now,seller_payout_status:"eligible",completed_at:now}).eq("id",tx.id);
      await supabase.from("commissions").upsert({transaction_id:tx.id,amount:Number(tx.commission_amount||0),status:"eligible",eligible_at:now},{onConflict:"transaction_id"});
      const item=o.order_items?.[0];
      if(item?.product_id){
        await supabase.from("products").update({stock:0,status:"active",sold_order_id:orderId,sold_at:now,updated_at:now}).eq("id",item.product_id);
      }
      await addHistory(orderId,"completed",u.id,"Customer confirmed: I Have Received My Product.");
      return json({success:true,message:"Receipt confirmed. The product is now marked SOLD and the seller's product money is available for settlement."});
    }

    if(action==="seller_orders"){
      const {data:businesses,error:be}=await supabase.from("businesses").select("id").eq("owner_id",u.id); if(be) throw be;
      const ids=(businesses||[]).map(x=>x.id); if(!ids.length) return json({orders:[]});
      const {data,error}=await supabase.from("orders").select("id,buyer_id,business_id,total_amount,product_subtotal,delivery_fee,delivery_address,status,payment_status,created_at,delivery_fee_set_at,paid_at,dispatched_at,delivered_at,received_at,businesses(business_name),order_items(product_id,quantity,unit_price,products(name))").in("business_id",ids).order("created_at",{ascending:false}); if(error) throw error;
      return json({orders:data||[]});
    }

    if(action==="buyer_orders"){
      const {data,error}=await supabase.from("orders").select("id,buyer_id,business_id,total_amount,product_subtotal,delivery_fee,delivery_address,status,payment_status,created_at,delivery_fee_set_at,paid_at,dispatched_at,delivered_at,received_at,businesses(business_name),order_items(product_id,quantity,unit_price,products(name))").eq("buyer_id",u.id).order("created_at",{ascending:false}); if(error) throw error;
      return json({orders:data||[]});
    }

    return json({error:"Unknown order lifecycle action."},400);
  }catch(error){
    console.error("SALGA ORDER LIFECYCLE ERROR",error);
    return json({error:error?.message||"Order operation failed."},500);
  }
}

export const config={path:"/api/order-lifecycle"};
