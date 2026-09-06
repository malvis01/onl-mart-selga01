import { createClient } from "@supabase/supabase-js";

const env=n=>{try{if(typeof Netlify!=="undefined"&&Netlify.env?.get)return Netlify.env.get(n)}catch(_){}return typeof process!=="undefined"?process.env?.[n]:undefined};
const url=env("SUPABASE_URL")||env("VITE_SUPABASE_URL");
const key=env("SUPABASE_SERVICE_ROLE_KEY")||env("SUPABASE_ANON_KEY")||env("VITE_SUPABASE_ANON_KEY")||env("VITE_SUPABASE_PUBLISHABLE_KEY");
const ADMIN_ID="de0e3f27-7913-495e-b4f9-303d0477b5cc";
const headers={"Content-Type":"application/json","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type, Authorization","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(b,s=200)=>new Response(JSON.stringify(b),{status:s,headers});
const supabase=url&&key?createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}}):null;
export default async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers});
  if(req.method!=="POST")return json({success:false,error:"Method not allowed."},405);
  try{
    if(!supabase)return json({success:false,error:"Supabase is not configured."},500);
    const auth=req.headers.get("authorization")||"";
    if(!auth.toLowerCase().startsWith("bearer "))return json({success:false,error:"Please log in to message SALGA administration."},401);
    const {data,error}=await supabase.auth.getUser(auth.slice(7).trim());
    if(error||!data?.user)return json({success:false,error:"Your session has expired. Please log in again."},401);
    const user=data.user;
    const {data:profile}=await supabase.from("profiles").select("id,role").eq("id",user.id).maybeSingle();
    if(!profile)return json({success:false,error:"User profile not found."},404);
    if(String(profile.role||"").toLowerCase()!=="buyer")return json({success:false,error:"Only buyers can start this chat."},403);
    const {data:existing,error:findError}=await supabase.from("chat_conversations").select("*").eq("buyer_id",user.id).eq("admin_involved",true).limit(1).maybeSingle();
    if(findError)throw findError;
    if(existing)return json({success:true,conversation:existing});
    const {data:conversation,error:createError}=await supabase.from("chat_conversations").insert({buyer_id:user.id,seller_id:null,admin_involved:true,business_id:null}).select("*").single();
    if(createError)throw createError;
    return json({success:true,conversation,admin_id:ADMIN_ID});
  }catch(error){console.error("ADMIN CHAT ERROR",error);return json({success:false,error:error?.message||"Unable to start admin chat."},500)}
};
export const config={path:"/api/chat-admin"};
