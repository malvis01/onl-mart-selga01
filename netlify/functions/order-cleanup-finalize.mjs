import { createClient } from "@supabase/supabase-js";
const url=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL;
const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase=createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
const TERMINAL=["cancelled","unsuccessful","failed","rejected"];
const missing=e=>e&&/does not exist|could not find the table|column .* does not exist/i.test(String(e.message||""));
async function removeOrder(order){
  const id=order.id;
  const {data:txs,error:txRead}=await supabase.from("transactions").select("id").eq("order_id",id);if(txRead&&!missing(txRead))throw txRead;
  for(const tx of txs||[]){const {error}=await supabase.from("commissions").delete().eq("transaction_id",tx.id);if(error&&!missing(error))throw error;}
  for(const table of ["order_notifications","order_status_history","order_items","payments","support_tickets"]){const {error}=await supabase.from(table).delete().eq("order_id",id);if(error&&!missing(error))throw error;}
  const {error:txDelete}=await supabase.from("transactions").delete().eq("order_id",id);if(txDelete&&!missing(txDelete))throw txDelete;
  const {error:productReset}=await supabase.from("products").update({reserved_order_id:null,reserved_at:null}).eq("reserved_order_id",id);if(productReset&&!missing(productReset))throw productReset;
  const {error:orderDelete}=await supabase.from("orders").delete().eq("id",id);if(orderDelete)throw orderDelete;
}
export default async function handler(){
  if(!url||!key)throw new Error("Supabase server configuration is missing.");
  const cutoff=new Date(Date.now()-24*60*60*1000).toISOString();
  const {data:orders,error}=await supabase.from("orders").select("id,status,updated_at,cancelled_at,created_at").in("status",TERMINAL).lt("updated_at",cutoff).limit(200);
  if(error)throw error;let deleted=0;
  for(const order of orders||[]){try{await removeOrder(order);deleted++;}catch(e){console.error("ORDER CLEANUP FINALIZE FAILED",order.id,e?.message||e);}}
  return new Response(JSON.stringify({success:true,deleted,retention_hours:24,kept_status:"completed"}),{status:200,headers:{"Content-Type":"application/json"}});
}
export const config={schedule:"15 * * * *"};
