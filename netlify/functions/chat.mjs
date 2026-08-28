import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  Netlify.env.get("SUPABASE_URL") ||
  Netlify.env.get("VITE_SUPABASE_URL");

const supabaseKey =
  Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  Netlify.env.get("SUPABASE_ANON_KEY") ||
  Netlify.env.get("VITE_SUPABASE_ANON_KEY");

const supabase = createClient(supabaseUrl, supabaseKey);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
    }
  });
}

export default async function handler(request) {
  if (request.method === "OPTIONS") {
    return json({ ok: true });
  }

  try {
    const url = new URL(request.url);

    if (request.method === "GET") {
      const conversationId = url.searchParams.get("conversation_id");

      if (!conversationId) {
        return json({
          ok: false,
          error: "conversation_id is required"
        }, 400);
      }

      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });

      if (error) throw error;

      return json({
        ok: true,
        messages: data || []
      });
    }

    if (request.method === "POST") {
      const body = await request.json();

      const {
        conversation_id,
        sender_id,
        sender_role,
        message
      } = body;

      if (!conversation_id || !sender_id || !message) {
        return json({
          ok: false,
          error: "conversation_id, sender_id and message are required"
        }, 400);
      }

      const { data, error } = await supabase
        .from("messages")
        .insert({
          conversation_id,
          sender_id,
          sender_role: sender_role || "buyer",
          message: String(message).trim()
        })
        .select()
        .single();

      if (error) throw error;

      return json({
        ok: true,
        message: data
      });
    }

    return json({
      ok: false,
      error: "Method not allowed"
    }, 405);

  } catch (error) {
    console.error("CHAT ERROR:", error);

    return json({
      ok: false,
      error: error.message || "Chat service error"
    }, 500);
  }
}

export const config = {
  path: "/api/chat"
};
