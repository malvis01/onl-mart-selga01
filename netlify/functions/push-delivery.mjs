import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
export async function sendPushToUser(userId,payload){
  if(!userId||!process.env.VAPID_PUBLIC_KEY||!process.env.VAPID_PRIVATE_KEY||!process.env.VAPID_SUBJECT)return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT,process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
  const {data:subs,error}=await db.from("push_subscriptions").select("id,endpoint,p256dh,auth").eq("user_id",userId); if(error)throw error;
  const {count}=await db.from("order_notifications").select("id",{count:"exact",head:true}).eq("recipient_id",userId).is("read_at",null);
  for(const s of subs||[]){try{await webpush.sendNotification({endpoint:s.endpoint,keys:{p256dh:s.p256dh,auth:s.auth}},JSON.stringify({...payload,badge:Number(count||0)}));}catch(e){const code=Number(e?.statusCode||0);if(code===404||code===410)await db.from("push_subscriptions").delete().eq("id",s.id);else console.error("SALGA PUSH",e?.message||e);}}
}
