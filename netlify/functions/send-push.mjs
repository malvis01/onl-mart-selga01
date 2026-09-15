import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

const supabase=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type, Authorization","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(b,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...headers,"Content-Type":"application/json"}});
function configured(){return Boolean(process.env.VAPID_PUBLIC_KEY&&process.env.VAPID_PRIVATE_KEY&&process.env.VAPID_SUBJECT);}
function setup(){if(!configured())return false;webpush.setVapidDetails(process.env.VAPID_SUBJECT,process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);return true;}
export async function sendPushToUser(userId,payload){
  if(!userId||!setup())return {sent:0,configured:false};
  const {data:subs,error}=await supabase.from("push_subscriptions").select("id,endpoint,p256dh,auth").eq("user_id",userId);
  if(error)throw error;
  let sent=0;
  for(const s of subs||[]){
    try{await webpush.sendNotification({endpoint:s.endpoint,keys:{p256dh:s.p256dh,auth:s.auth}},JSON.stringify(payload));sent++;}
    catch(e){const status=Number(e?.statusCode||0);if(status===404||status===410){await supabase.from("push_subscriptions").delete().eq("id",s.id);}else console.error("SALGA PUSH SEND",status,e?.message||e);}
  }
  return {sent,configured:true};
}

export default async function handler(req){
  if(req.method==="OPTIONS")return new Response("ok",{headers});
  if(req.method!=="POST")return json({error:"Method not allowed"},405);
  try{
    if(!setup())return json({success:false,configured:false,message:"Web push is not configured yet."},200);
    const body=await req.json().catch(()=>({}));
    if(!body.user_id||!body.title||!body.message)return json({error:"user_id, title and message are required."},400);
    const {data:count,error}=await supabase.from("order_notifications").select("id",{count:"exact",head:true}).eq("recipient_id",body.user_id).is("read_at",null);
    if(error)throw error;
    const result=await sendPushToUser(body.user_id,{title:String(body.title),body:String(body.message),url:String(body.url||"/"),badge:Number(count||0),tag:String(body.tag||"salga-update")});
    return json({success:true,...result});
  }catch(e){console.error("SALGA SEND PUSH",e);return json({error:e?.message||"Push delivery failed."},500)}
}
export const config={path:"/api/send-push"};
