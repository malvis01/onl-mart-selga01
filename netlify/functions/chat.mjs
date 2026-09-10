import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const env = (name) => {
  try { if (typeof Netlify !== "undefined" && Netlify.env?.get) return Netlify.env.get(name); } catch (_) {}
  return typeof process !== "undefined" ? process.env?.[name] : undefined;
};
const SUPABASE_URL = env("SUPABASE_URL") || env("VITE_SUPABASE_URL");
const SUPABASE_KEY = env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SECRET_KEY") || env("SUPABASE_ANON_KEY") || env("SUPABASE_PUBLISHABLE_KEY") || env("VITE_SUPABASE_PUBLISHABLE_KEY");
const ADMIN_ID = "de0e3f27-7913-495e-b4f9-303d0477b5cc";
const ADMIN_EMAIL = "malvisdabz@gmail.com";
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth:{ autoRefreshToken:false, persistSession:false, detectSessionInUrl:false } }) : null;
const headers = { "Content-Type":"application/json", "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"Content-Type, Authorization", "Access-Control-Allow-Methods":"GET, POST, OPTIONS" };
const json = (body,status=200) => new Response(JSON.stringify(body),{status,headers});

async function getUser(req){
  if(!supabase) return null;
  const auth=req.headers.get("authorization")||"";
  if(!auth.toLowerCase().startsWith("bearer ")) return null;
  const {data,error}=await supabase.auth.getUser(auth.slice(7).trim());
  return error||!data?.user ? null : data.user;
}
async function getProfile(id){
  const {data,error}=await supabase.from("profiles").select("id,full_name,phone,email,role").eq("id",id).maybeSingle();
  if(error) throw error; return data;
}
function isAdmin(user,profile){return user.id===ADMIN_ID||String(profile?.role||"").toLowerCase()==="admin"||String(profile?.email||"").toLowerCase()===ADMIN_EMAIL;}
function roleOf(p){return String(p?.role||"").toLowerCase();}

async function customerCareAI(body){
  const message=String(body.message||"").trim();
  if(!message) return json({success:false,error:"Please enter a question."},400);
  if(message.length>4000) return json({success:false,error:"Please keep your question under 4,000 characters."},400);
  const apiKey=env("OPENAI_API_KEY");
  if(!apiKey) return json({success:false,error:"AI Customer Care is not configured yet. Please contact the administrator."},503);
  try{
    const client=new OpenAI({apiKey});
    const response=await client.responses.create({model:env("OPENAI_MODEL")||"gpt-5-mini",instructions:`You are SALGA Digital Mart's official AI Customer Care assistant for Sagbama LGA, Bayelsa State, Nigeria. Help buyers and business owners with accounts, products, buying, orders, payments, seller onboarding, promotions and support. Marketplace commission is 5% and promotion/advertising commission is 3%. Never invent account, order, payment, stock or balance information. Never ask for passwords, OTPs, PINs or API keys. If an account-specific investigation is needed, direct the user to SALGA administration. Be friendly, concise and practical. Current role: ${body.context?.role||"guest"}.`,input:message,max_output_tokens:700});
    return json({success:true,reply:response.output_text||"Sorry, I could not answer right now. Please try again."});
  }catch(error){console.error("AI CUSTOMER CARE ERROR",error);return json({success:false,error:"AI Customer Care is temporarily unavailable. Please try again shortly."},500);}
}

async function findAdminConversation(participantId,businessId=null){
  let q=supabase.from("chat_conversations").select("*").eq("admin_involved",true).limit(20);
  if(businessId) q=q.eq("business_id",businessId); else q=q.is("business_id",null);
  const {data,error}=await q;
  if(error) throw error;
  return (data||[]).find(c=>c.buyer_id===participantId||c.seller_id===participantId)||null;
}

async function startConversation(user,profile,body){
  const requestedId=String(body.recipient_id||body.receiver_id||"").trim();
  const businessId=body.business_id?String(body.business_id):null;
  const admin=isAdmin(user,profile);
  const myRole=roleOf(profile);

  if(body.action==="start_admin"){
    if(admin) return json({success:false,error:"Admin cannot start a conversation with administration."},400);
    const existing=await findAdminConversation(user.id,null);
    if(existing) return json({success:true,conversation:existing});
    const row={buyer_id:myRole==="buyer"?user.id:null,seller_id:myRole==="seller"?user.id:null,admin_involved:true,business_id:null};
    const {data,error}=await supabase.from("chat_conversations").insert(row).select("*").single();
    if(error) throw error; return json({success:true,conversation:data});
  }
  if(!requestedId&&!businessId) return json({success:false,error:"Recipient or business is required."},400);

  let recipientId=requestedId;
  if(businessId){
    const {data:business,error}=await supabase.from("businesses").select("id,owner_id,business_name,status").eq("id",businessId).maybeSingle();
    if(error) throw error;
    if(!business) return json({success:false,error:"Business not found."},404);
    if(!admin&&business.owner_id===user.id) return json({success:false,error:"You cannot message your own business."},400);
    if(!admin&&String(business.status||"active").toLowerCase()!=="active") return json({success:false,error:"This business is not currently active."},400);
    recipientId=business.owner_id;
  }
  if(!recipientId||recipientId===user.id) return json({success:false,error:"Invalid recipient."},400);
  const recipientProfile=await getProfile(recipientId);
  if(!recipientProfile) return json({success:false,error:"Recipient account not found."},404);
  const recipientIsAdmin=recipientId===ADMIN_ID||roleOf(recipientProfile)==="admin"||String(recipientProfile.email||"").toLowerCase()===ADMIN_EMAIL;

  if(!admin&&recipientIsAdmin){
    const existing=await findAdminConversation(user.id,null);
    if(existing) return json({success:true,conversation:existing});
    const row={buyer_id:myRole==="buyer"?user.id:null,seller_id:myRole==="seller"?user.id:null,admin_involved:true,business_id:null};
    const {data,error}=await supabase.from("chat_conversations").insert(row).select("*").single();
    if(error) throw error; return json({success:true,conversation:data});
  }
  if(admin){
    const existing=await findAdminConversation(recipientId,businessId);
    if(existing) return json({success:true,conversation:existing});
    const rr=roleOf(recipientProfile);
    if(rr!=="buyer"&&rr!=="seller") return json({success:false,error:"Admin can only start chats with buyers or business owners."},400);
    const row={buyer_id:rr==="buyer"?recipientId:null,seller_id:rr==="seller"?recipientId:null,admin_involved:true,business_id:businessId};
    const {data,error}=await supabase.from("chat_conversations").insert(row).select("*").single();
    if(error) throw error; return json({success:true,conversation:data});
  }
  const rr=roleOf(recipientProfile);
  if(myRole==="buyer"&&rr!=="seller") return json({success:false,error:"Buyers can message business owners or SALGA administration."},403);
  if(myRole==="seller"&&rr!=="buyer") return json({success:false,error:"Business owners can message buyers or SALGA administration."},403);
  const buyerId=myRole==="buyer"?user.id:recipientId;
  const sellerId=myRole==="seller"?user.id:recipientId;
  let q=supabase.from("chat_conversations").select("*").eq("buyer_id",buyerId).eq("seller_id",sellerId).eq("admin_involved",false);
  if(businessId) q=q.eq("business_id",businessId); else q=q.is("business_id",null);
  const {data:existing}=await q.limit(1);
  if(existing?.[0]) return json({success:true,conversation:existing[0]});
  const {data,error}=await supabase.from("chat_conversations").insert({buyer_id:buyerId,seller_id:sellerId,business_id:businessId,admin_involved:false}).select("*").single();
  if(error) throw error; return json({success:true,conversation:data});
}

function participant(c,userId,admin){return !!c&&(admin&&c.admin_involved||c.buyer_id===userId||c.seller_id===userId);}
async function getConversation(user,profile,id){
  const conversationId=Number(id); if(!Number.isInteger(conversationId)||conversationId<=0) return json({success:false,error:"Invalid conversation."},400);
  const admin=isAdmin(user,profile);
  const {data:c,error}=await supabase.from("chat_conversations").select("*").eq("id",conversationId).maybeSingle();
  if(error) throw error; if(!c||!participant(c,user.id,admin)) return json({success:false,error:"You are not allowed to view this conversation."},403);
  const {data:messages,error:me}=await supabase.from("chat_messages").select("*").eq("conversation_id",conversationId).order("created_at",{ascending:true}).limit(500);
  if(me) throw me; return json({success:true,conversation:c,messages:messages||[]});
}
async function sendMessage(user,profile,body){
  const id=Number(body.conversation_id||body.conversationId); const text=String(body.message||body.content||"").trim();
  if(!Number.isInteger(id)||id<=0) return json({success:false,error:"Invalid conversation."},400);
  if(!text) return json({success:false,error:"Message cannot be empty."},400);
  if(text.length>5000) return json({success:false,error:"Message is too long."},400);
  const admin=isAdmin(user,profile); const {data:c,error}=await supabase.from("chat_conversations").select("*").eq("id",id).maybeSingle();
  if(error) throw error; if(!c||!participant(c,user.id,admin)) return json({success:false,error:"You are not allowed to send to this conversation."},403);
  const role=admin?"admin":roleOf(profile)||"buyer";
  const {data,error:ie}=await supabase.from("chat_messages").insert({conversation_id:id,sender_id:user.id,sender_role:role,message:text}).select("*").single();
  if(ie) throw ie; await supabase.from("chat_conversations").update({updated_at:new Date().toISOString()}).eq("id",id);
  return json({success:true,message:data});
}
async function listConversations(user,profile){
  const admin=isAdmin(user,profile); let q=supabase.from("chat_conversations").select("*").order("updated_at",{ascending:false}).limit(200);
  if(admin) q=q.eq("admin_involved",true); else q=q.or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`);
  const {data,error}=await q; if(error) throw error;
  const conversations=[];
  for(const c of data||[]){
    const otherId=admin?(c.buyer_id||c.seller_id):(c.buyer_id===user.id?c.seller_id:c.seller_id===user.id?c.buyer_id:(c.buyer_id||c.seller_id));
    const other=otherId?await getProfile(otherId):null;
    const otherName=other?.full_name||other?.phone||(roleOf(other)==="seller"?"Business Owner":roleOf(other)==="buyer"?"Buyer":"Participant");
    conversations.push({id:c.id,conversation_id:c.id,conversation_key:String(c.id),business_id:c.business_id,buyer_id:c.buyer_id,seller_id:c.seller_id,admin_involved:c.admin_involved,name:c.admin_involved?(admin?otherName:"SALGA Administration"):otherName,other_user_id:otherId,other_role:other?.role||null,last_message_at:c.updated_at||c.created_at});
  }
  return json({success:true,conversations});
}

export default async function handler(req){
  if(req.method==="OPTIONS") return new Response("ok",{headers});
  if(req.method!=="POST") return json({success:false,error:"Method not allowed."},405);
  try{
    const body=await req.json();
    if(body.action==="customer_care_ai") return await customerCareAI(body);
    if(!supabase) return json({success:false,error:"Supabase is not configured."},500);
    const user=await getUser(req); if(!user) return json({success:false,error:"Please log in to use messaging."},401);
    const profile=await getProfile(user.id); if(!profile) return json({success:false,error:"User profile not found."},404);
    if(body.action==="start"||body.action==="start_admin") return await startConversation(user,profile,body);
    if(body.action==="conversations") return await listConversations(user,profile);
    if(body.action==="messages") return await getConversation(user,profile,body.conversation_id||body.conversationId);
    if(body.action==="send") return await sendMessage(user,profile,body);
    if(body.action==="mark_read"){
      const id=Number(body.conversation_id||body.conversationId),admin=isAdmin(user,profile);
      const {data:c}=await supabase.from("chat_conversations").select("*").eq("id",id).maybeSingle();
      if(!c||!participant(c,user.id,admin)) return json({success:false,error:"Conversation not found."},404);
      await supabase.from("chat_messages").update({read_at:new Date().toISOString()}).eq("conversation_id",id).neq("sender_id",user.id).is("read_at",null); return json({success:true});
    }
    return json({success:false,error:"Unknown chat action."},400);
  }catch(error){console.error("CHAT ERROR",error);return json({success:false,error:error?.message||"Unable to process chat request."},500);}
}
export const config={path:"/api/chat"};