import { createClient } from "@supabase/supabase-js";
const supabase=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type, Authorization","Access-Control-Allow-Methods":"GET, OPTIONS"};
const json=(b,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...headers,"Content-Type":"application/json"}});
export default async req=>{if(req.method==="OPTIONS")return new Response("ok",{headers});if(req.method!=="GET")return json({error:"Method not allowed"},405);try{const q=new URL(req.url).searchParams;const businessId=q.get("business_id");const userId=q.get("user_id");if(!businessId&&!userId)return json({error:"business_id or user_id is required."},400);
 if(businessId){const {data:b,error}=await supabase.from("businesses").select("id,owner_id,business_name,description,category,address,location,logo_url,verified,status").eq("id",businessId).eq("status","active").maybeSingle();if(error)throw error;if(!b)return json({error:"Business not found."},404);const {data:p}=await supabase.from("profiles").select("id,full_name,role,avatar_url").eq("id",b.owner_id).maybeSingle();return json({success:true,business:b,owner:p?{id:p.id,full_name:p.full_name,role:p.role,avatar_url:p.avatar_url}:null});}
 const {data:p,error}=await supabase.from("profiles").select("id,full_name,role,avatar_url").eq("id",userId).maybeSingle();if(error)throw error;if(!p)return json({error:"Profile not found."},404);return json({success:true,profile:p});
 }catch(e){return json({error:e?.message||"Profile lookup failed."},500)}};
export const config={path:"/api/public-profile"};
