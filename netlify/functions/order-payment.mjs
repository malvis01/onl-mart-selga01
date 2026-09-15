import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL=process.env.SUPABASE_URL;
const SUPABASE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;
const PAYSTACK_SECRET=process.env.PAYSTACK_SECRET_KEY;
const supabase=createClient(SUPABASE_URL,SUPABASE_KEY);
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type, Authorization","Access-Control-Allow-Methods":"GET, POST, OPTIONS"};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{...headers,"Content-Type":"application/json"}});
async function getUser(req){const a=req.headers.get("authorization");if(!a?.startsWith("Bearer "))return null;const {data,error}=await supabase.auth.getUser(a.slice(7));return error||!data?.user?null:data.user;}
async function paystack(path,options={}){return fetch("https://api.paystack.co"+path,{...options,headers:{Authorization:`Bearer ${PAYSTACK_SECRET}`,"Content-Type":"application/json",...(options.headers||{})}})}
async function history(orderId,status,actorId,note){await supabase.from("order_status_history").insert({order_id:orderId,status,actor_id:actorId,note});}

async function finalizePayment(reference){
 const vr=await paystack(`/transaction/verify/${encodeURIComponent(reference)}`);const result=await vr.json();
 if(!vr.ok||!result.status||result.data?.status!=="success")return {ok:false,status:result.data?.status||"failed",message:result.message||"Payment has not been confirmed."};
 const {data:payment,error:pe}=await supabase.from("payments").select("id,order_id,buyer_id,seller_id,amount,status,reference").eq("reference",reference).maybeSingle();if(pe)throw pe;if(!payment)return {ok:false,status:"missing",message:"Payment record was not found."};
 if(payment.status==="paid")return {ok:true,alreadyProcessed:true,orderId:payment.order_id};
 const {data:o,error:oe}=await supabase.from("orders").select("id,buyer_id,business_id,total_amount,product_subtotal,delivery_fee,status,payment_status,delivery_address,order_items(product_id,quantity,unit_price)").eq("id",payment.order_id).single();if(oe)throw oe;
 if(o.buyer_id!==payment.buyer_id)return {ok:false,status:"forbidden",message:"Payment buyer mismatch."};
 if(o.status!=="delivery_fee_set")return {ok:false,status:"invalid_order",message:"This order is not ready for payment."};
 const subtotal=Number(o.product_subtotal||0);const delivery=Number(o.delivery_fee||0);const total=Number(o.total_amount||0);
 if(Math.round((subtotal+delivery)*100)!==Math.round(total*100))return {ok:false,status:"amount_mismatch",message:"Order amount could not be reconciled."};
 const item=o.order_items?.[0];if(!item?.product_id)return {ok:false,status:"missing_product",message:"The product record for this order was not found."};
 // Claim the one-item listing atomically. If somebody else completed it first, refund the successful charge.
 const {data:claimed,error:ce}=await supabase.from("products").update({stock:0,updated_at:new Date().toISOString()}).eq("id",item.product_id).eq("stock",1).select("id").maybeSingle();if(ce)throw ce;
 if(!claimed){
   await supabase.from("payments").update({status:"refunded"}).eq("id",payment.id);
   await supabase.from("orders").update({payment_status:"refunded",status:"cancelled",cancelled_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",o.id);
   await paystack("/refund",{method:"POST",body:JSON.stringify({transaction:reference,merchant_note:"SALGA refund: product was no longer available."})});
   await history(o.id,"cancelled",null,"Payment succeeded but the one-item product had already been sold; refund requested.");
   return {ok:false,status:"sold",message:"This product was sold by another customer just before payment completed. A refund has been requested."};
 }
 const commission=Math.round(subtotal*0.05*100)/100;const sellerAmount=Math.round((subtotal-commission)*100)/100;const now=new Date().toISOString();
 await supabase.from("payments").update({status:"paid"}).eq("id",payment.id);
 await supabase.from("orders").update({payment_status:"paid",status:"confirmed",payment_reference:reference,paid_at:now,seller_amount:sellerAmount,delivery_fee_released:0,updated_at:now}).eq("id",o.id);
 let {data:tx,error:te}=await supabase.from("transactions").select("*").eq("order_id",o.id).maybeSingle();if(te)throw te;
 if(!tx){const r=await supabase.from("transactions").insert({order_id:o.id,buyer_id:o.buyer_id,seller_id:payment.seller_id,gross_amount:subtotal,product_subtotal:subtotal,delivery_fee:delivery,commission_rate:5,commission_amount:commission,seller_amount:sellerAmount,status:"pending",seller_payout_status:"held",delivery_fee_payout_status:"pending",created_at:now}).select("*").single();if(r.error)throw r.error;tx=r.data;}
 else await supabase.from("transactions").update({gross_amount:subtotal,product_subtotal:subtotal,delivery_fee:delivery,commission_amount:commission,seller_amount:sellerAmount,status:"pending",seller_payout_status:"held"}).eq("id",tx.id);
 const {data:wallet}=await supabase.from("platform_wallet").select("id,total_gross,total_commission").limit(1).maybeSingle();if(wallet)await supabase.from("platform_wallet").update({total_gross:Number(wallet.total_gross||0)+subtotal,total_commission:Number(wallet.total_commission||0)+commission,updated_at:now}).eq("id",wallet.id);
 // Release only the delivery fee first. Product money stays held until customer confirms receipt.
 let deliveryTransferStatus="not_configured";let deliveryTransferReference=null;
 if(delivery>0){
   const {data:b}=await supabase.from("businesses").select("payout_recipient_code").eq("id",o.business_id).maybeSingle();
   if(b?.payout_recipient_code && PAYSTACK_SECRET){
     deliveryTransferReference=`salga-delivery-${o.id.replace(/-/g,"").slice(0,24)}`;
     const tr=await paystack("/transfer",{method:"POST",body:JSON.stringify({source:"balance",amount:Math.round(delivery*100),recipient:b.payout_recipient_code,reference:deliveryTransferReference,reason:`SALGA delivery fee for order ${o.id}`,currency:"NGN"})});
     const td=await tr.json();
     deliveryTransferStatus=td?.data?.status||"failed";
     if(tr.ok&&td.status&&["success","pending","otp"].includes(deliveryTransferStatus)){
       await supabase.from("orders").update({delivery_fee_transfer_reference:deliveryTransferReference,delivery_fee_payout_status:deliveryTransferStatus,delivery_fee_released:deliveryTransferStatus==="success"?delivery:0}).eq("id",o.id);
       await supabase.from("transactions").update({delivery_fee_transfer_reference:deliveryTransferReference,delivery_fee_payout_status:deliveryTransferStatus}).eq("id",tx.id);
     }
   }
 }
 await history(o.id,"confirmed",null,`Payment confirmed. Product money is held; delivery fee transfer status: ${deliveryTransferStatus}.`);
 return {ok:true,orderId:o.id,reference,amount:total,productSubtotal:subtotal,deliveryFee:delivery,commission,sellerAmount,deliveryTransferStatus,deliveryTransferReference};
}

export default async function handler(req){
 if(req.method==="OPTIONS")return new Response("ok",{headers});
 if(!PAYSTACK_SECRET)return json({error:"Paystack secret key is not configured."},503);
 try{
  if(req.method==="GET"){
    const ref=new URL(req.url).searchParams.get("reference");if(!ref)return json({error:"Payment reference is required."},400);
    const result=await finalizePayment(ref);
    if(result.ok)return Response.redirect(new URL(`/?payment_complete=1&order_id=${encodeURIComponent(result.orderId||"")}`,req.url),303);
    return Response.redirect(new URL(`/?payment_error=${encodeURIComponent(result.message||"Payment could not be confirmed.")}`,req.url),303);
  }
  if(req.method!=="POST")return json({error:"Method not allowed"},405);
  const u=await getUser(req);if(!u)return json({error:"Login required"},401);
  const body=await req.json().catch(()=>({}));
  if(body.action==="initialize_order"){
    const orderId=body.order_id;
    const {data:o,error:oe}=await supabase.from("orders").select("id,buyer_id,business_id,total_amount,product_subtotal,delivery_fee,status,payment_status,order_items(product_id,quantity,unit_price),businesses(owner_id)").eq("id",orderId).maybeSingle();if(oe)throw oe;if(!o||o.buyer_id!==u.id)return json({error:"Order not found."},404);
    if(o.status!=="delivery_fee_set"||o.payment_status!=="pending")return json({error:"The seller has not finished setting the delivery fee for this order."},400);
    const item=o.order_items?.[0];const {data:p}=await supabase.from("products").select("id,stock,status,approved").eq("id",item?.product_id).maybeSingle();if(!p||p.stock!==1||p.status!=="active"||!p.approved)return json({error:"This product is no longer available."},409);
    const ref="SALGA_"+Date.now()+"_"+crypto.randomUUID().replace(/-/g,"").slice(0,10);const amount=Math.round(Number(o.total_amount)*100);
    const {error:pe}=await supabase.from("payments").insert({order_id:o.id,buyer_id:u.id,seller_id:o.businesses.owner_id,amount:Number(o.total_amount),status:"pending",reference:ref,provider:"paystack"});if(pe)throw pe;
    const payload={email:"customer@salgadigitalmart.com",amount,reference:ref,currency:"NGN",channels:["card","bank","bank_transfer","ussd","qr","payattitude"],callback_url:new URL(req.url).origin+`/api/order-payment?reference=${encodeURIComponent(ref)}`,metadata:{orderId:o.id,productId:item.product_id,businessId:o.business_id,buyerId:u.id,sellerId:o.businesses.owner_id,deliveryFee:Number(o.delivery_fee),productSubtotal:Number(o.product_subtotal)}};
    const pr=await paystack("/transaction/initialize",{method:"POST",body:JSON.stringify(payload)});const pd=await pr.json();if(!pr.ok||!pd.status||!pd.data?.authorization_url){await supabase.from("payments").update({status:"failed"}).eq("reference",ref);return json({error:pd.message||"Payment initialization failed."},400)}
    return json({success:true,authorization_url:pd.data.authorization_url,access_code:pd.data.access_code,reference:ref,orderId:o.id,amount:Number(o.total_amount),productSubtotal:Number(o.product_subtotal),deliveryFee:Number(o.delivery_fee)});
  }
  if(body.action==="verify")return json(await finalizePayment(body.reference));
  return json({error:"Unknown payment action."},400);
 }catch(e){console.error("SALGA ORDER PAYMENT ERROR",e);return json({error:e?.message||"Payment operation failed."},500)}
}
export const config={path:"/api/order-payment"};
