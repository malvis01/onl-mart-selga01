import { createClient } from "@supabase/supabase-js";
const supabase=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{autoRefreshToken:false,persistSession:false}});
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type, Authorization","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(b,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...headers,"Content-Type":"application/json"}});
async function user(req){const a=req.headers.get("authorization")||"";if(!a.toLowerCase().startsWith("bearer "))return null;const {data,error}=await supabase.auth.getUser(a.slice(7).trim());return error||!data?.user?null:data.user;}
export default async function handler(req){
 if(req.method==="OPTIONS")return new Response("ok",{headers});
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 try{
  const u=await user(req);if(!u)return json({error:"Login required"},401);
  const body=await req.json().catch(()=>({}));
  const allowed=new Set(["page_view","login","logout","product_view","search","order_created","payment_started","payment_completed","message_sent","seller_product_created","seller_order_updated","buyer_order_updated","notification_viewed"]);
  const eventType=String(body.event_type||"").trim();
  if(!allowed.has(eventType))return json({error:"Unsupported activity event."},400);
  const {error}=await supabase.from("user_activity_events").insert({user_id:u.id,session_id:String(body.session_id||"").slice(0,120)||null,event_type:eventType,path:String(body.path||"").slice(0,500)||null,metadata:body.metadata&&typeof body.metadata==="object"?body.metadata:{}});
  if(error)throw error;
  return json({success:true});
 }catch(e){console.error("SALGA ACTIVITY ERROR",e);return json({error:e?.message||"Activity could not be recorded."},500)}
}
export const config={path:"/api/activity"};
