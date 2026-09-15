import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
const SECRET=process.env.PAYSTACK_SECRET_KEY;const supabase=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
export default async req=>{
 if(req.method!=="POST")return new Response(JSON.stringify({error:"Method not allowed"}),{status:405});
 const raw=await req.text();const sig=req.headers.get("x-paystack-signature");if(!SECRET||!sig)return new Response(JSON.stringify({error:"Unauthorized"}),{status:401});
 const expected=crypto.createHmac("sha512",SECRET).update(raw).digest("hex");if(!crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(sig)))return new Response(JSON.stringify({error:"Invalid signature"}),{status:401});
 const event=JSON.parse(raw);const ref=event.data?.reference;if(!ref)return new Response(JSON.stringify({received:true}));
 if(["transfer.success","transfer.failed","transfer.reversed"].includes(event.event)){
  const status=event.event==="transfer.success"?"success":event.event==="transfer.failed"?"failed":"reversed";const amount=Number(event.data?.amount||0)/100;const now=new Date().toISOString();
  const {data:order}=await supabase.from("orders").select("id").eq("delivery_fee_transfer_reference",ref).maybeSingle();
  if(order)await supabase.from("orders").update({delivery_fee_payout_status:status,delivery_fee_released:status==="success"?amount:0,updated_at:now}).eq("id",order.id);
  const {data:tx}=await supabase.from("transactions").select("id,order_id,seller_amount").eq("seller_payout_reference",ref).maybeSingle();
  if(tx)await supabase.from("transactions").update({seller_payout_status:status==="success"?"paid":status==="failed"||status==="reversed"?"eligible":"processing",status:status==="success"?"settled":"eligible",seller_payout_processed_at:status==="success"?now:null}).eq("id",tx.id);
 }
 return new Response(JSON.stringify({received:true}),{status:200,headers:{"Content-Type":"application/json"}});
};
export const config={path:"/api/paystack-transfer-webhook"};
