import { createClient } from "@supabase/supabase-js";

const supabase=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type, Authorization","Access-Control-Allow-Methods":"POST, DELETE, OPTIONS"};
const json=(b,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...headers,"Content-Type":"application/json"}});
async function user(req){const a=req.headers.get("authorization");if(!a?.startsWith("Bearer "))return null;const {data,error}=await supabase.auth.getUser(a.slice(7));return error||!data?.user?null:data.user;}
export default async function handler(req){
  if(req.method==="OPTIONS")return new Response("ok",{headers});
  try{
    const u=await user(req); if(!u)return json({error:"Login required"},401);
    const body=await req.json().catch(()=>({}));
    if(req.method==="POST"){
      const s=body.subscription||body;
      if(!s?.endpoint||!s?.keys?.p256dh||!s?.keys?.auth)return json({error:"Invalid push subscription."},400);
      const {error}=await supabase.from("push_subscriptions").upsert({user_id:u.id,endpoint:String(s.endpoint),p256dh:String(s.keys.p256dh),auth:String(s.keys.auth),expiration_time:s.expirationTime==null?null:Number(s.expirationTime),user_agent:String(body.user_agent||req.headers.get("user-agent")||"").slice(0,1000),updated_at:new Date().toISOString()},{onConflict:"user_id,endpoint"});
      if(error)throw error; return json({success:true});
    }
    if(req.method==="DELETE"){
      if(!body.endpoint)return json({error:"Endpoint is required."},400);
      const {error}=await supabase.from("push_subscriptions").delete().eq("user_id",u.id).eq("endpoint",String(body.endpoint));
      if(error)throw error; return json({success:true});
    }
    return json({error:"Method not allowed"},405);
  }catch(e){console.error("SALGA PUSH SUBSCRIPTION",e);return json({error:e?.message||"Push subscription failed."},500)}
}
export const config={path:"/api/push-subscription"};
