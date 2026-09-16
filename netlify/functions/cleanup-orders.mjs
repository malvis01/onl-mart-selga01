import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const TERMINAL_STATUSES = ["cancelled","unsuccessful","failed","rejected"];
const HOURS = 24;
const cutoffMs = () => Date.now() - HOURS*60*60*1000;
const ignoreMissing = error => error && /does not exist|could not find the table|column .* does not exist/i.test(String(error.message||""));

async function removeOrder(order){
  const id = order.id;
  const {data:txs,error:txRead} = await supabase.from("transactions").select("id").eq("order_id",id);
  if(txRead && !ignoreMissing(txRead)) throw txRead;
  for(const tx of txs || []){
    const {error} = await supabase.from("commissions").delete().eq("transaction_id",tx.id);
    if(error && !ignoreMissing(error)) throw error;
  }
  for(const table of ["order_notifications","order_status_history","order_items"]){
    const {error} = await supabase.from(table).delete().eq("order_id",id);
    if(error && !ignoreMissing(error)) throw error;
  }
  const {error:txDelete} = await supabase.from("transactions").delete().eq("order_id",id);
  if(txDelete && !ignoreMissing(txDelete)) throw txDelete;
  const {error:orderDelete} = await supabase.from("orders").delete().eq("id",id);
  if(orderDelete) throw orderDelete;
}

export default async function handler(){
  if(!SUPABASE_URL || !SUPABASE_KEY) throw new Error("Supabase server configuration is missing.");
  const cutoff = new Date(cutoffMs()).toISOString();
  const {data:orders,error} = await supabase.from("orders")
    .select("id,status,created_at,updated_at,cancelled_at")
    .in("status",TERMINAL_STATUSES)
    .lt("updated_at",cutoff)
    .limit(200);
  if(error) throw error;
  let deleted = 0;
  for(const order of orders || []){
    const terminalTime = new Date(order.updated_at || order.cancelled_at || order.created_at).getTime();
    if(terminalTime > cutoffMs()) continue;
    try{ await removeOrder(order); deleted++; }
    catch(error){ console.error("SALGA ORDER CLEANUP FAILED",order.id,error?.message||error); }
  }
  return new Response(JSON.stringify({success:true,deleted,checked:(orders||[]).length,retention_hours:HOURS,kept_status:"completed"}),{status:200,headers:{"Content-Type":"application/json"}});
}

export const config = { schedule: "0 * * * *" };
