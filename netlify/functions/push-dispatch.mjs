import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(){
  if(!process.env.VAPID_PUBLIC_KEY||!process.env.VAPID_PRIVATE_KEY||!process.env.VAPID_SUBJECT)return new Response("Push not configured",{status:200});
  webpush.setVapidDetails(process.env.VAPID_SUBJECT,process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
  const {data:items,error}=await db.from("order_notifications").select("id,recipient_id,title,message,created_at").is("push_sent_at",null).order("created_at",{ascending:true}).limit(100);
  if(error)throw error;
  for(const item of items||[]){
    const {data:subs}=await db.from("push_subscriptions").select("id,endpoint,p256dh,auth").eq("user_id",item.recipient_id);
    let delivered=false;
    const {count}=await db.from("order_notifications").select("id",{count:"exact",head:true}).eq("recipient_id",item.recipient_id).is("read_at",null);
    for(const sub of subs||[]){
      try{await webpush.sendNotification({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth}},JSON.stringify({title:item.title,body:item.message,url:"/",badge:Number(count||0),tag:`salga-${item.id}`}));delivered=true;}
      catch(e){const code=Number(e?.statusCode||0);if(code===404||code===410)await db.from("push_subscriptions").delete().eq("id",sub.id);else console.error("SALGA PUSH",e?.message||e);}
    }
    if(delivered||!(subs||[]).length)await db.from("order_notifications").update({push_sent_at:new Date().toISOString()}).eq("id",item.id).is("push_sent_at",null);
  }
  return new Response("ok",{status:200});
}

export const config={schedule:"* * * * *"};
