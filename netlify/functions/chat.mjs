import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  Netlify.env.get("SUPABASE_URL") ||
  Netlify.env.get("VITE_SUPABASE_URL");

const SUPABASE_KEY =
  Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  Netlify.env.get("SUPABASE_ANON_KEY") ||
  Netlify.env.get("VITE_SUPABASE_ANON_KEY");

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export default async (request) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return json({
        ok: false,
        error: "Supabase is not configured in Netlify."
      }, 500);
    }

    if (request.method === "OPTIONS") {
      return new Response("", {
        status: 204,
        headers: corsHeaders()
      });
    }

    if (request.method !== "POST") {
      return json({
        ok: false,
        error: "Method not allowed."
      }, 405);
    }

    const body = await request.json();

    const action = body.action;

    /*
      IMPORTANT:
      Never convert a numeric application ID such as "1"
      into a UUID. Supabase Auth users have UUIDs.

      The frontend can send:
        user_id
        sender_id
        buyer_id
        seller_id

      but they must be real Supabase Auth UUIDs.
    */

    if (action === "send_message") {
      return await sendMessage(body);
    }

    if (action === "get_messages") {
      return await getMessages(body);
    }

    if (action === "create_conversation") {
      return await createConversation(body);
    }

    if (action === "get_conversations") {
      return await getConversations(body);
    }

    if (action === "customer_care") {
      return await customerCare(body);
    }

    return json({
      ok: false,
      error: "Unknown chat action."
    }, 400);

  } catch (error) {
    console.error("CHAT FUNCTION ERROR:", error);

    return json({
      ok: false,
      error: error?.message || "Chat request failed."
    }, 500);
  }
};


/* =========================================================
   CREATE CONVERSATION
   ========================================================= */

async function createConversation(body) {
  const userId = validUUID(
    body.user_id ||
    body.sender_id ||
    body.buyer_id
  );

  const otherUserId = validUUID(
    body.other_user_id ||
    body.receiver_id ||
    body.seller_id
  );

  /*
    Customer-care conversations don't require another user.
    They can simply be connected to the logged-in user.
  */

  if (!userId) {
    return json({
      ok: false,
      error: "A valid Supabase user UUID is required."
    }, 400);
  }

  if (!otherUserId && body.type !== "customer_care") {
    return json({
      ok: false,
      error: "A valid receiver UUID is required."
    }, 400);
  }

  /*
    First try to find an existing conversation.
  */

  if (otherUserId) {
    const { data: existing, error: existingError } = await supabase
      .from("conversations")
      .select("*")
      .or(
        `and(user1_id.eq.${userId},user2_id.eq.${otherUserId}),and(user1_id.eq.${otherUserId},user2_id.eq.${userId})`
      )
      .limit(1)
      .maybeSingle();

    if (!existingError && existing) {
      return json({
        ok: true,
        conversation: existing,
        conversation_id: existing.id
      });
    }
  }

  const insertData = {
    user1_id: userId,
    user2_id: otherUserId || null
  };

  /*
    Only add these fields if the table supports them.
    This prevents the function from breaking if your
    existing conversations table is simpler.
  */

  let { data, error } = await supabase
    .from("conversations")
    .insert(insertData)
    .select("*")
    .single();

  if (error) {
    /*
      Some versions of the database may use participant IDs
      with different names. Return the real database error
      instead of inventing a UUID or using "1".
    */

    console.error("CREATE CONVERSATION ERROR:", error);

    return json({
      ok: false,
      error: error.message
    }, 400);
  }

  return json({
    ok: true,
    conversation: data,
    conversation_id: data.id
  });
}


/* =========================================================
   SEND MESSAGE
   ========================================================= */

async function sendMessage(body) {
  const conversationId = validUUID(
    body.conversation_id ||
    body.conversationId
  );

  const senderId = validUUID(
    body.sender_id ||
    body.user_id
  );

  const message =
    body.message ??
    body.content ??
    body.text ??
    "";

  if (!conversationId) {
    return json({
      ok: false,
      error: "Invalid conversation UUID."
    }, 400);
  }

  if (!senderId) {
    return json({
      ok: false,
      error: "Invalid sender UUID. Please log in again."
    }, 400);
  }

  if (!String(message).trim()) {
    return json({
      ok: false,
      error: "Message cannot be empty."
    }, 400);
  }

  /*
    IMPORTANT:
    conversation_id and sender_id are UUIDs.
    We never send numeric IDs such as "1".
  */

  const insertData = {
    conversation_id: conversationId,
    sender_id: senderId,
    content: String(message).trim()
  };

  const { data, error } = await supabase
    .from("messages")
    .insert(insertData)
    .select("*")
    .single();

  if (error) {
    console.error("SEND MESSAGE ERROR:", error);

    return json({
      ok: false,
      error: error.message
    }, 400);
  }

  return json({
    ok: true,
    message: data
  });
}


/* =========================================================
   GET MESSAGES
   ========================================================= */

async function getMessages(body) {
  const conversationId = validUUID(
    body.conversation_id ||
    body.conversationId
  );

  if (!conversationId) {
    return json({
      ok: false,
      error: "Invalid conversation UUID."
    }, 400);
  }

  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", {
      ascending: true
    });

  if (error) {
    console.error("GET MESSAGES ERROR:", error);

    return json({
      ok: false,
      error: error.message
    }, 400);
  }

  return json({
    ok: true,
    messages: data || []
  });
}


/* =========================================================
   GET CONVERSATIONS
   ========================================================= */

async function getConversations(body) {
  const userId = validUUID(
    body.user_id ||
    body.sender_id
  );

  if (!userId) {
    return json({
      ok: false,
      error: "Invalid user UUID. Please log in again."
    }, 400);
  }

  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .or(
      `user1_id.eq.${userId},user2_id.eq.${userId}`
    )
    .order("created_at", {
      ascending: false
    });

  if (error) {
    console.error("GET CONVERSATIONS ERROR:", error);

    return json({
      ok: false,
      error: error.message
    }, 400);
  }

  return json({
    ok: true,
    conversations: data || []
  });
}


/* =========================================================
   PLATFORM CUSTOMER CARE
   ========================================================= */

async function customerCare(body) {
  const userId = validUUID(
    body.user_id ||
    body.sender_id
  );

  const message =
    body.message ??
    body.content ??
    body.text ??
    "";

  if (!userId) {
    return json({
      ok: false,
      error: "Please log in to send and receive platform customer-care messages."
    }, 401);
  }

  if (!String(message).trim()) {
    return json({
      ok: false,
      error: "Message cannot be empty."
    }, 400);
  }

  /*
    Look for an existing customer-care conversation.

    We use the normal conversations table and UUIDs.
    We DO NOT use chat_conversations.business_id.
  */

  let conversation = null;

  const { data: existing, error: lookupError } = await supabase
    .from("conversations")
    .select("*")
    .or(
      `user1_id.eq.${userId},user2_id.eq.${userId}`
    )
    .order("created_at", {
      ascending: false
    })
    .limit(1);

  if (!lookupError && existing && existing.length) {
    conversation = existing[0];
  }

  /*
    If no conversation exists, create one.

    Customer care does not need a fake user ID such as "1".
    We keep user2_id NULL.
  */

  if (!conversation) {
    const { data: created, error: createError } = await supabase
      .from("conversations")
      .insert({
        user1_id: userId,
        user2_id: null
      })
      .select("*")
      .single();

    if (createError) {
      console.error("CUSTOMER CARE CONVERSATION ERROR:", createError);

      return json({
        ok: false,
        error: createError.message
      }, 400);
    }

    conversation = created;
  }

  /*
    Save the customer's message.
  */

  const { data: savedMessage, error: messageError } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversation.id,
      sender_id: userId,
      content: String(message).trim()
    })
    .select("*")
    .single();

  if (messageError) {
    console.error("CUSTOMER CARE MESSAGE ERROR:", messageError);

    return json({
      ok: false,
      error: messageError.message
    }, 400);
  }

  return json({
    ok: true,
    conversation_id: conversation.id,
    message: savedMessage
  });
}


/* =========================================================
   UUID VALIDATION
   ========================================================= */

function validUUID(value) {
  if (!value) return null;

  const stringValue = String(value).trim();

  /*
    This deliberately rejects values such as:
      "1"
      "2"
      "123"

    because those are not Supabase UUIDs.
  */

  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  return uuidRegex.test(stringValue)
    ? stringValue
    : null;
}


/* =========================================================
   RESPONSE HELPERS
   ========================================================= */

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization",
    "Access-Control-Allow-Methods":
      "POST, OPTIONS",
    "Content-Type":
      "application/json"
  };
}

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: corsHeaders()
    }
  );
}
