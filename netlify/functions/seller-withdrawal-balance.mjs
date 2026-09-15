import { createClient } from "@supabase/supabase-js";
const supabase=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{autoRefreshToken:false,persistSession:false}});
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type, Authorization","Access-Control-Allow-Methods":"GET, OPTIONS"};
const json=(b,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...headers,"Content-Type":"application/json"}});
async function user(req){const a=req.headers.get("authorization")||"";if(!a.toLowerCase().startsWith("bearer "))return null;const {data,error}=await supabase.auth.getUser(a.slice(7).trim());return error||!data?.user?null:data.user;}
export default async function handler(req){
 if(req.method==="OPTIONS")return new Response("ok",{headers});
 if(req.method!=="GET")return json({error:"Method not allowed"},405);
 try{
  const u=await user(req);if(!u)return json({error:"Login required"},401);
  const {data:business,error:be}=await supabase.from("businesses").select("id,business_name,bank_name,account_number,account_name,withdrawal_pin_hash,payout_verified_at").eq("owner_id",u.id).order("created_at",{ascending:true}).limit(1).maybeSingle();
  if(be)throw be;
  const {data:balance,error:balanceError}=await supabase.rpc("seller_available_balance",{p_seller_id:u.id});
  if(balanceError)throw balanceError;
  return json({success:true,available_balance:Number(balance||0),pin_set:!!business?.withdrawal_pin_hash,business:business?{id:business.id,business_name:business.business_name,bank_name:business.bank_name,account_number:business.account_number,account_name:business.account_name,payout_verified_at:business.payout_verified_at}:null});
 }catch(e){console.error("SALGA SELLER BALANCE ERROR",e);return json({error:e?.message||"Could not load seller withdrawal balance."},500)}
}
export const config={path:"/api/seller-withdrawal-balance"};
