import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const TERMINAL_STATUSES = ["completed","cancelled","unsuccessful","failed","rejected","expired"];
const HOURS = 25;

async function removeOrder(order){
  const id = order.id;
  // Remove dependent records explicitly so cleanup works even when
  // foreign keys are not configured with ON DELETE CASCADE.
  const childTables = [
    "order_notifications",
    "order_status_history",
    "order_items",
    "transactions",
    "commissions"
  ];
  for(const table of childTables){
    const {error} = await supabase.from(table).delete().eq("order_id",id);
    if(error && !String(error.message||"").toLowerCase().includes("does not exist")) throw error;
  }
  const {error} = await supabase.from("orders").delete().eq("id",id);
  if(error) throw error;
}

export default async function handler(){
  if(!SUPABASE_URL || !SUPABASE_KEY) throw new Error("Supabase server configuration is missing.");
  const cutoff = new Date(Date.now() - HOURS*60*60*1000).toISOString();
  const {data:orders,error} = await supabase.from("orders")
    .select("id,status,created_at,updated_at,completed_at,cancelled_at,payment_status")
    .in("status",TERMINAL_STATUSES)
    .lt("updated_at",cutoff)
    .limit(200);
  if(error) throw error;

  let deleted = 0;
  for(const order of orders || []){
    // Keep the 25-hour window anchored to the terminal update time.
    if(new Date(order.updated_at || order.completed_at || order.cancelled_at || order.created_at).getTime() > Date.now()-HOURS*60*60*1000) continue;
    try{
      await removeOrder(order);
      deleted++;
    }catch(error){
      console.error("SALGA ORDER CLEANUP FAILED",order.id,error?.message||error);
    }
  }
  return new Response(JSON.stringify({success:true,deleted,checked:(orders||[]).length,retention_hours:HOURS}),{status:200,headers:{"Content-Type":"application/json"}});
}

export const config = { schedule: "0 * * * *" };
