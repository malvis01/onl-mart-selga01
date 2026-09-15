import { createClient } from '@supabase/supabase-js';
const supabase=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{autoRefreshToken:false,persistSession:false}});
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{...headers,'Content-Type':'application/json'}});
async function auth(req){const a=req.headers.get('authorization')||'';if(!a.toLowerCase().startsWith('bearer '))return null;const {data,error}=await supabase.auth.getUser(a.slice(7).trim());if(error||!data?.user)return null;const {data:p}=await supabase.from('profiles').select('role').eq('id',data.user.id).maybeSingle();return p?.role==='admin'?data.user:null;}
export default async function handler(req){
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 const admin=await auth(req);if(!admin)return json({error:'Admin access required.'},403);
 try{
  if(req.method==='GET'){
   const {data:overview,error:e1}=await supabase.rpc('admin_marketplace_overview');if(e1)throw e1;
   const {data:activity,error:e2}=await supabase.rpc('admin_user_activity');if(e2)throw e2;
   const {data:orders,error:e3}=await supabase.from('orders').select('id,buyer_id,business_id,total_amount,product_subtotal,delivery_fee,service_fee,status,payment_status,created_at,updated_at,paid_at,delivered_at,received_at').order('created_at',{ascending:false}).limit(100);if(e3)throw e3;
   return json({success:true,overview,users:activity?.users||[],orders:orders||[]});
  }
  if(req.method==='POST'){
   const body=await req.json().catch(()=>({}));const userId=String(body.user_id||'');const action=body.action==='restrict'?'restrict':'restore';const reason=String(body.reason||'').trim().slice(0,500);if(!userId)return json({error:'User ID is required.'},400);if(userId===admin.id)return json({error:'The administrator cannot restrict their own account.'},400);
   const update=action==='restrict'?{account_status:'restricted',restricted_at:new Date().toISOString(),restricted_reason:reason||'Restricted by administrator.'}:{account_status:'active',restricted_at:null,restricted_reason:null};
   const {error}=await supabase.from('profiles').update(update).eq('id',userId).neq('role','admin');if(error)throw error;
   return json({success:true,message:action==='restrict'?'User restricted successfully.':'User access restored successfully.'});
  }
  return json({error:'Method not allowed.'},405);
 }catch(e){console.error('SALGA ADMIN MONITORING ERROR',e);return json({error:e?.message||'Admin monitoring failed.'},500)}
}
export const config={path:'/api/admin-monitoring'};
