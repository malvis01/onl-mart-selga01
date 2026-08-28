import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  Netlify.env.get("SUPABASE_URL") ||
  Netlify.env.get("VITE_SUPABASE_URL");

const SUPABASE_SERVICE_ROLE_KEY =
  Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Supabase server environment variables are missing.");
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization",
  "Access-Control-Allow-Methods":
    "GET, POST, OPTIONS"
};

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        ...headers,
        "Content-Type": "application/json"
      }
    }
  );
}

async function getUser(request) {
  const authorization =
    request.headers.get("authorization");

  if (
    !authorization ||
    !authorization.toLowerCase().startsWith("bearer ")
  ) {
    return null;
  }

  const token =
    authorization.substring(7).trim();

  if (!token) return null;

  const {
    data,
    error
  } = await supabase.auth.getUser(token);

  if (error || !data?.user) {
    console.error("CHAT AUTH ERROR:", error);
    return null;
  }

  return data.user;
}

function clean(value) {
  return String(value ?? "").trim();
}

/*
=========================================================
GET CONVERSATION MESSAGES
=========================================================
*/

async function getMessages(conversationId) {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", {
      ascending: true
    });

  if (error) throw error;

  return data || [];
}

/*
=========================================================
SEND MESSAGE
=========================================================
*/

async function sendMessage({
  conversationId,
  senderId,
  senderRole,
  message
}) {
  const text = clean(message);

  if (!conversationId) {
    throw new Error(
      "conversation_id is required."
    );
  }

  if (!senderId) {
    throw new Error(
      "sender_id is required."
    );
  }

  if (!text) {
    throw new Error(
      "Message cannot be empty."
    );
  }

  const { data, error } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      sender_id: senderId,
      sender_role: senderRole || "buyer",
      message: text
    })
    .select("*")
    .single();

  if (error) throw error;

  /*
   * Update conversation timestamp if the
   * conversations table exists.
   */
  const { error: updateError } = await supabase
    .from("chat_conversations")
    .update({
      updated_at: new Date().toISOString()
    })
    .eq("id", conversationId);

  /*
   * Do not fail the actual message if the
   * timestamp update is unavailable.
   */
  if (updateError) {
    console.warn(
      "Conversation timestamp update skipped:",
      updateError.message
    );
  }

  return data;
}

/*
=========================================================
CREATE OR FIND BUYER / SELLER CONVERSATION
=========================================================
*/

async function getOrCreateConversation({
  buyerId,
  sellerId,
  businessId
}) {
  if (!buyerId) {
    throw new Error("buyer_id is required.");
  }

  if (!sellerId) {
    throw new Error("seller_id is required.");
  }

  let query = supabase
    .from("chat_conversations")
    .select("*")
    .eq("buyer_id", buyerId)
    .eq("seller_id", sellerId);

  if (businessId) {
    query = query.eq(
      "business_id",
      businessId
    );
  }

  const {
    data: existing,
    error: existingError
  } = await query
    .order("updated_at", {
      ascending: false
    })
    .limit(1);

  if (existingError) {
    throw existingError;
  }

  if (existing?.length) {
    return existing[0];
  }

  const insertData = {
    buyer_id: buyerId,
    seller_id: sellerId
  };

  if (businessId) {
    insertData.business_id =
      businessId;
  }

  const {
    data,
    error
  } = await supabase
    .from("chat_conversations")
    .insert(insertData)
    .select("*")
    .single();

  if (error) throw error;

  return data;
}

/*
=========================================================
GET USER CONVERSATIONS
=========================================================
*/

async function getUserConversations(user) {
  const { data: buyerConversations, error: buyerError } =
    await supabase
      .from("chat_conversations")
      .select("*")
      .eq("buyer_id", user.id)
      .order("updated_at", {
        ascending: false
      });

  if (buyerError) {
    throw buyerError;
  }

  const { data: sellerConversations, error: sellerError } =
    await supabase
      .from("chat_conversations")
      .select("*")
      .eq("seller_id", user.id)
      .order("updated_at", {
        ascending: false
      });

  if (sellerError) {
    throw sellerError;
  }

  const combined = [
    ...(buyerConversations || []),
    ...(sellerConversations || [])
  ];

  const unique = new Map();

  for (const conversation of combined) {
    unique.set(
      conversation.id,
      conversation
    );
  }

  return Array.from(
    unique.values()
  ).sort((a, b) => {
    const aTime =
      new Date(
        a.updated_at ||
        a.created_at ||
        0
      ).getTime();

    const bTime =
      new Date(
        b.updated_at ||
        b.created_at ||
        0
      ).getTime();

    return bTime - aTime;
  });
}

/*
=========================================================
CUSTOMER CARE
=========================================================
*/

async function customerCareConversation(user) {
  /*
   * Find an existing customer-care conversation.
   *
   * Customer care conversations use:
   *   buyer_id = authenticated user
   *   seller_id = null
   *   business_id = null
   */

  const { data, error } = await supabase
    .from("chat_conversations")
    .select("*")
    .eq("buyer_id", user.id)
    .is("seller_id", null)
    .is("business_id", null)
    .order("updated_at", {
      ascending: false
    })
    .limit(1);

  if (error) throw error;

  if (data?.length) {
    return data[0];
  }

  const {
    data: created,
    error: createError
  } = await supabase
    .from("chat_conversations")
    .insert({
      buyer_id: user.id,
      seller_id: null,
      business_id: null
    })
    .select("*")
    .single();

  if (createError) {
    throw createError;
  }

  return created;
}

/*
=========================================================
MAIN HANDLER
=========================================================
*/

export default async function handler(request) {
  if (request.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers
    });
  }

  try {
    const user = await getUser(request);

    if (!user) {
      return json(
        {
          ok: false,
          error: "Login required."
        },
        401
      );
    }

    const url =
      new URL(request.url);

    /*
     * Support both:
     *
     * /api/chat?action=messages
     *
     * and:
     *
     * /api/chat?conversation_id=...
     */

    const action =
      clean(
        url.searchParams.get("action")
      ).toLowerCase();

    /*
     ========================================================
     GET
     ========================================================
    */

    if (request.method === "GET") {

      /*
       * GET messages
       */
      if (
        action === "messages" ||
        url.searchParams.has(
          "conversation_id"
        )
      ) {
        const conversationId =
          clean(
            url.searchParams.get(
              "conversation_id"
            )
          );

        if (!conversationId) {
          return json(
            {
              ok: false,
              error:
                "conversation_id is required."
            },
            400
          );
        }

        const messages =
          await getMessages(
            conversationId
          );

        return json({
          ok: true,
          messages
        });
      }

      /*
       * GET conversations
       */
      if (
        action === "conversations" ||
        action === "list"
      ) {
        const conversations =
          await getUserConversations(
            user
          );

        return json({
          ok: true,
          conversations
        });
      }

      /*
       * GET customer care conversation
       */
      if (
        action === "customer_care"
      ) {
        const conversation =
          await customerCareConversation(
            user
          );

        const messages =
          await getMessages(
            conversation.id
          );

        return json({
          ok: true,
          conversation,
          messages
        });
      }

      return json({
        ok: true,
        conversations:
          await getUserConversations(
            user
          )
      });
    }

    /*
     ========================================================
     POST
     ========================================================
    */

    if (request.method === "POST") {
      const body =
        await request.json();

      /*
       * Accept different names used
       * by the existing frontend.
       */
      const requestedAction =
        clean(
          body.action ||
          action
        ).toLowerCase();

      /*
       * Customer care message
       */
      if (
        requestedAction ===
          "customer_care_send" ||
        requestedAction ===
          "customer-care-send"
      ) {
        let conversationId =
          clean(
            body.conversation_id
          );

        if (!conversationId) {
          const conversation =
            await customerCareConversation(
              user
            );

          conversationId =
            conversation.id;
        }

        const message =
          await sendMessage({
            conversationId,
            senderId: user.id,
            senderRole:
              "customer",
            message:
              body.message ||
              body.text
          });

        return json({
          ok: true,
          message,
          conversation_id:
            conversationId
        });
      }

      /*
       * Create/find conversation
       */
      if (
        requestedAction ===
          "create_conversation" ||
        requestedAction ===
          "conversation"
      ) {
        const conversation =
          await getOrCreateConversation({
            buyerId:
              body.buyer_id ||
              (
                body.sender_role ===
                "buyer"
                  ? user.id
                  : null
              ),

            sellerId:
              body.seller_id,

            businessId:
              body.business_id
          });

        return json({
          ok: true,
          conversation
        });
      }

      /*
       * Normal send message
       */
      if (
        requestedAction ===
          "send" ||
        requestedAction ===
          "message" ||
        requestedAction === ""
      ) {
        let conversationId =
          clean(
            body.conversation_id
          );

        /*
         * If frontend did not supply a
         * conversation ID, create one
         * when buyer + seller are supplied.
         */
        if (!conversationId) {
          if (
            body.seller_id ||
            body.business_id
          ) {
            const conversation =
              await getOrCreateConversation({
                buyerId:
                  body.buyer_id ||
                  user.id,

                sellerId:
                  body.seller_id,

                businessId:
                  body.business_id
              });

            conversationId =
              conversation.id;
          }
        }

        if (!conversationId) {
          return json(
            {
              ok: false,
              error:
                "conversation_id is required."
            },
            400
          );
        }

        /*
         * Never allow a client to
         * impersonate another sender.
         */
        const senderRole =
          clean(
            body.sender_role ||
            body.senderRole
          ).toLowerCase();

        let safeRole = "buyer";

        if (
          senderRole === "seller"
        ) {
          safeRole = "seller";
        } else if (
          senderRole === "admin"
        ) {
          safeRole = "admin";
        } else if (
          senderRole === "customer"
        ) {
          safeRole = "customer";
        }

        const message =
          await sendMessage({
            conversationId,
            senderId: user.id,
            senderRole: safeRole,
            message:
              body.message ||
              body.text
          });

        return json({
          ok: true,
          message,
          conversation_id:
            conversationId
        });
      }

      return json(
        {
          ok: false,
          error:
            "Unknown chat action."
        },
        400
      );
    }

    return json(
      {
        ok: false,
        error:
          "Method not allowed."
      },
      405
    );

  } catch (error) {
    console.error(
      "CHAT ERROR:",
      error
    );

    return json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Chat service error."
      },
      500
    );
  }
}

export const config = {
  path: "/api/chat"
};
