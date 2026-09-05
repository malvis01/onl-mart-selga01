import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const supabase = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });

async function getUser(req) {
  if (!supabase) return null;
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  const { data, error } = await supabase.auth.getUser(token);
  return error || !data?.user ? null : data.user;
}

function conversationKey(a, b) {
  if (!a || !b || a === b) return "";
  return [a, b].sort().join(":");
}

async function tableForMessages() {
  for (const table of ["chat_messages", "messages"]) {
    const { error } = await supabase.from(table).select("id").limit(1);
    if (!error || !String(error.message || "").toLowerCase().includes("relation")) {
      return table;
    }
  }
  return "chat_messages";
}

async function aiCustomerCare(body) {
  const message = String(body.message || "").trim();
  if (!message) return json({ success: false, error: "Please enter a question." }, 400);
  if (message.length > 4000) return json({ success: false, error: "Please keep your question under 4,000 characters." }, 400);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return json({ success: false, error: "AI Customer Care is not configured yet. Please contact the administrator." }, 503);
  }

  try {
    const client = new OpenAI({ apiKey });
    const role = body.context?.role || "guest";

    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5-mini",
      instructions: `You are SALGA Digital Mart's official AI Customer Care assistant for Sagbama LGA, Bayelsa State, Nigeria.

Your job is to help buyers and business owners use the marketplace. Explain account creation/login, finding products, buying, orders, payments, seller onboarding, uploading products, promotions, commissions, and contacting support.

Important platform rules:
- Marketplace commission is 5% on completed marketplace transactions.
- Promotion/advertising commission is 3%.
- Payments are processed through the platform's configured payment provider; never claim a payment succeeded unless the system confirms it.
- Never invent an order, payment, refund, balance, stock level, business, or account detail.
- Never ask for passwords, OTPs, PINs, bank PINs, API keys, or other secrets.
- If the user needs an account-specific action or manual investigation, tell them to contact SALGA administration.
- Be friendly, concise, practical, and easy for Nigerian mobile users to understand.
- If the user asks how to buy something, give clear numbered steps.
- If the user reports an error, first explain the likely cause and the next safe step.

The current user's role is: ${role}.`,
      input: message,
      max_output_tokens: 700
    });

    return json({
      success: true,
      reply: response.output_text || "Sorry, I couldn't generate an answer right now. Please try again."
    });
  } catch (error) {
    console.error("AI CUSTOMER CARE ERROR", error);
    return json({ success: false, error: "AI Customer Care is temporarily unavailable. Please try again shortly." }, 500);
  }
}

async function loadConversation(user, key) {
  if (!key || !key.split(":").includes(user.id)) {
    return json({ success: false, error: "You are not allowed to view this conversation." }, 403);
  }
  const table = await tableForMessages();
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq("conversation_key", key)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) return json({ success: false, error: error.message }, 500);
  return json({ success: true, messages: data || [] });
}

async function sendMessage(user, body) {
  const key = String(body.conversation_id || body.conversation_key || "").trim();
  const text = String(body.message || "").trim();
  if (!key || !key.split(":").includes(user.id)) return json({ success: false, error: "Invalid conversation." }, 400);
  if (!text) return json({ success: false, error: "Message cannot be empty." }, 400);
  if (text.length > 5000) return json({ success: false, error: "Message is too long." }, 400);

  const parts = key.split(":");
  const receiverId = parts.find(id => id !== user.id);
  if (!receiverId) return json({ success: false, error: "Conversation recipient could not be found." }, 400);

  const table = await tableForMessages();
  const payload = {
    sender_id: user.id,
    receiver_id: receiverId,
    conversation_key: key,
    message: text,
    content: text,
    created_at: new Date().toISOString()
  };

  let result = await supabase.from(table).insert(payload).select("*").single();
  if (result.error) {
    result = await supabase.from(table).insert({
      sender_id: user.id,
      receiver_id: receiverId,
      message: text,
      created_at: payload.created_at
    }).select("*").single();
  }
  if (result.error) return json({ success: false, error: result.error.message }, 500);
  return json({ success: true, message: result.data });
}

async function listConversations(user) {
  const table = await tableForMessages();
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return json({ success: false, error: error.message }, 500);

  const seen = new Set();
  const conversations = [];
  for (const row of data || []) {
    const key = row.conversation_key || conversationKey(row.sender_id, row.receiver_id);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const other = key.split(":").find(id => id !== user.id);
    conversations.push({
      id: key,
      name: other ? `Conversation ${String(other).slice(0, 8)}` : "Customer Care",
      conversation_key: key,
      last_message: row.message || row.content || "",
      last_message_at: row.created_at || null
    });
  }
  return json({ success: true, conversations });
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed." }, 405);

  try {
    const body = await req.json();

    if (body.action === "customer_care_ai") {
      return await aiCustomerCare(body);
    }

    if (!supabase) return json({ success: false, error: "Supabase is not configured." }, 500);

    const user = await getUser(req);
    if (!user) return json({ success: false, error: "Please log in to use messaging." }, 401);

    if (body.action === "messages") {
      return await loadConversation(user, String(body.conversation_id || body.conversation_key || ""));
    }

    if (body.action === "send") {
      return await sendMessage(user, body);
    }

    if (body.action === "conversations") {
      return await listConversations(user);
    }

    if (body.action === "customer_care" || body.action === "customer_care_send") {
      return json({ success: true, messages: [] });
    }

    return json({ success: false, error: "Unknown chat action." }, 400);
  } catch (error) {
    console.error("CHAT ERROR", error);
    return json({ success: false, error: error?.message || "Unable to process chat request." }, 500);
  }
};

export const config = { path: "/api/chat" };
