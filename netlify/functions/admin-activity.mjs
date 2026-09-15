import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Netlify.env.get("SUPABASE_URL");
const SERVICE_KEY = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ADMIN_EMAIL = "malvisdabz@gmail.com";
const headers = { "Content-Type":"application/json", "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"Content-Type, Authorization", "Access-Control-Allow-Methods":"GET, OPTIONS" };
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
const supabase=createClient(SUPABASE_URL,SERVICE_KEY,{auth:{autoRefreshToken:false,persistSession:false}});
async function user(req){const a=req.headers.get("authorization")||"";if(!a.toLowerCase().startsWith("bearer "))return null;const {data,error}=await supabase.auth.getUser(a.slice(7).trim());return error||!data?.user?null:data.user;}
export default async function handler(req){
  if(req.method==="OPTIONS")return new Response("ok",{headers});
  if(req.method!=="GET")return json({error:"Method not allowed"},405);
  try{
    const u=await user(req);if(!u||String(u.email||"").toLowerCase()!==ADMIN_EMAIL)return json({error:"Admin access required"},403);
    const days=Math.max(1,Math.min(Number(new URL(req.url).searchParams.get("days")||30),365));
    const {data,error}=await supabase.rpc("admin_activity_overview",{p_days:days});
    if(error)throw error;
    const [users,businesses,orders,products]=await Promise.all([
      supabase.from("profiles").select("id,full_name,phone,email,role,created_at,updated_at").order("created_at",{ascending:false}),
      supabase.from("businesses").select("id,owner_id,business_name,status,verified,created_at,updated_at").order("created_at",{ascending:false}),
      supabase.from("orders").select("id,buyer_id,business_id,total_amount,status,payment_status,created_at,updated_at").order("created_at",{ascending:false}),
      supabase.from("products").select("id,business_id,name,status,approved,stock,created_at,updated_at").order("created_at",{ascending:false})
    ]);
    for(const r of [users,businesses,orders,products])if(r.error)throw r.error;
    return json({success:true,generated_at:new Date().toISOString(),activity:data||{},users:users.data||[],businesses:businesses.data||[],orders:orders.data||[],products:products.data||[]});
  }catch(e){console.error("ADMIN ACTIVITY ERROR",e);return json({error:e?.message||"Unable to load admin activity"},500)}
}
export const config={path:"/api/admin-activity"};
