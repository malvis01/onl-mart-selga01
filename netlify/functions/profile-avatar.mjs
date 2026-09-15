import { createClient } from "@supabase/supabase-js";
const URL=process.env.SUPABASE_URL;const KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;const supabase=createClient(URL,KEY);
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type, Authorization","Access-Control-Allow-Methods":"GET, POST, OPTIONS"};
const json=(b,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...headers,"Content-Type":"application/json"}});
async function user(req){const a=req.headers.get("authorization");if(!a?.startsWith("Bearer "))return null;const {data,error}=await supabase.auth.getUser(a.slice(7));return error||!data?.user?null:data.user;}
const types=new Set(["image/jpeg","image/png","image/webp","image/gif"]);
export default async req=>{if(req.method==="OPTIONS")return new Response("ok",{headers});try{const u=await user(req);if(!u)return json({error:"Login required"},401);
 if(req.method==="GET"){const {data:p,error}=await supabase.from("profiles").select("id,full_name,role,avatar_url").eq("id",u.id).single();if(error)throw error;return json({success:true,profile:p});}
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 const form=await req.formData();const file=form.get("avatar")||form.get("image")||form.get("file");if(!file||typeof file.arrayBuffer!=="function")return json({error:"Please choose a profile picture."},400);
 const type=String(file.type||"").toLowerCase();if(!types.has(type))return json({error:"Use JPG, PNG, WEBP or GIF."},400);if(!file.size||file.size>5*1024*1024)return json({error:"Profile picture must be 5 MB or smaller."},400);
 const {data:old}=await supabase.from("profiles").select("avatar_storage_path").eq("id",u.id).maybeSingle();
 if(old?.avatar_storage_path)await supabase.storage.from("profile-images").remove([old.avatar_storage_path]);
 const ext={"image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/gif":"gif"}[type];const path=`${u.id}/${crypto.randomUUID()}.${ext}`;
 const up=await supabase.storage.from("profile-images").upload(path,Buffer.from(await file.arrayBuffer()),{contentType:type,cacheControl:"31536000",upsert:false});if(up.error)throw up.error;
 const {data:pub}=supabase.storage.from("profile-images").getPublicUrl(path);const avatarUrl=pub.publicUrl;const {data:p,error:pe}=await supabase.from("profiles").update({avatar_url:avatarUrl,avatar_storage_path:path,updated_at:new Date().toISOString()}).eq("id",u.id).select("id,full_name,role,avatar_url").single();if(pe)throw pe;return json({success:true,profile:p,message:"Profile picture updated."});
 }catch(e){console.error("SALGA PROFILE AVATAR",e);return json({error:e?.message||"Profile picture upload failed."},500)}};
export const config={path:"/api/profile-avatar"};
