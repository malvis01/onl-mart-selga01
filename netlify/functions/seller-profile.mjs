import { createClient } from "@supabase/supabase-js";
const SUPABASE_URL=process.env.SUPABASE_URL;
const SUPABASE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;
const PAYSTACK_SECRET=process.env.PAYSTACK_SECRET_KEY;
const supabase=createClient(SUPABASE_URL,SUPABASE_KEY);
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type, Authorization","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{...headers,"Content-Type":"application/json"}});
async function getUser(req){const a=req.headers.get("authorization");if(!a?.startsWith("Bearer "))return null;const {data,error}=await supabase.auth.getUser(a.slice(7));return error||!data?.user?null:data.user;}
async function paystack(path,options={}){return fetch("https://api.paystack.co"+path,{...options,headers:{Authorization:`Bearer ${PAYSTACK_SECRET}`,"Content-Type":"application/json",...(options.headers||{})}})}
export default async function handler(req){
 if(req.method==="OPTIONS")return new Response("ok",{headers});
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 try{
  const u=await getUser(req);if(!u)return json({error:"Login required"},401);
  const body=await req.json().catch(()=>({}));
  const {data:business,error:be}=await supabase.from("businesses").select("*").eq("owner_id",u.id).limit(1).maybeSingle();
  if(be)throw be;if(!business)return json({error:"Business profile not found."},404);
  const patch={
   address:body.address!=null?String(body.address).trim():business.address,
   location:body.location!=null?String(body.location).trim():business.location,
   bank_name:body.bank_name!=null?String(body.bank_name).trim():business.bank_name,
   bank_code:body.bank_code!=null?String(body.bank_code).trim():business.bank_code,
   account_number:body.account_number!=null?String(body.account_number).replace(/\D/g,""):business.account_number,
   account_name:body.account_name!=null?String(body.account_name).trim():business.account_name,
   payout_provider:body.payout_provider||business.payout_provider||"paystack",
   updated_at:new Date().toISOString()
  };
  if(patch.account_number && patch.account_number.length!==10)return json({error:"A Nigerian bank account number should contain 10 digits."},400);
  if(patch.bank_code && !/^\d{3,6}$/.test(patch.bank_code))return json({error:"Please enter a valid bank code."},400);
  if(PAYSTACK_SECRET && patch.account_number && patch.bank_code && (!business.payout_recipient_code || patch.account_number!==business.account_number || patch.bank_code!==business.bank_code)){
   const name=patch.account_name||business.business_name||u.email||"SALGA Seller";
   const r=await paystack("/transferrecipient",{method:"POST",body:JSON.stringify({type:"nuban",name,account_number:patch.account_number,bank_code:patch.bank_code,currency:"NGN",description:`SALGA seller ${business.id}`})});
   const result=await r.json();
   if(!r.ok||!result.status||!result.data?.recipient_code)return json({error:result.message||"The bank account could not be verified by Paystack."},400);
   patch.account_name=result.data.details?.account_name||patch.account_name||name;
   patch.payout_recipient_code=result.data.recipient_code;
   patch.payout_verified_at=new Date().toISOString();
  }
  const {data:updated,error:ue}=await supabase.from("businesses").update(patch).eq("id",business.id).select("id,business_name,address,location,bank_name,bank_code,account_number,account_name,payout_provider,payout_recipient_code,payout_verified_at").single();
  if(ue)throw ue;
  const account={business_id:business.id,owner_id:u.id,provider:patch.payout_provider||"paystack",bank_name:patch.bank_name,bank_code:patch.bank_code,account_number:patch.account_number,account_name:patch.account_name,recipient_code:patch.payout_recipient_code||business.payout_recipient_code||null,verified:!!(patch.payout_recipient_code||business.payout_recipient_code),verified_at:patch.payout_verified_at||business.payout_verified_at||null,is_default:true,updated_at:new Date().toISOString()};
  const {data:existingAccount}=await supabase.from("seller_payout_accounts").select("id").eq("business_id",business.id).eq("is_default",true).maybeSingle();
  if(existingAccount)await supabase.from("seller_payout_accounts").update(account).eq("id",existingAccount.id);
  else await supabase.from("seller_payout_accounts").insert(account);
  return json({success:true,business:updated,message:"Business delivery location and payout details saved."});
 }catch(e){console.error("SALGA SELLER PROFILE ERROR",e);return json({error:e?.message||"Could not save business details."},500)}
}
export const config={path:"/api/seller-profile"};
