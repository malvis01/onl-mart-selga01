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

function clean(value) {
  return String(value ?? "").trim();
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

async function getMessages(conversationId) {
  const {
    data,
    error
  } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", {
      ascending: true
    });

  if (error) throw error;

  return data || [];
}

async function sendMessage({
  conversationId,
  senderId,
  senderRole,
  message
}) {
  const text = clean(message);

  if (!conversationId) {
    throw new Error("conversation_id is required.");
  }

  if (!senderId) {
    throw new Error("sender_id is required.");
  }

  if (!text) {
    throw new Error("Message cannot be empty.");
  }

  const {
    data,
    error
  } = await supabase
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

  const {
    error: updateError
  } = await supabase
    .from("chat_conversations")
    .update({
      updated_at: new Date().toISOString()
    })
    .eq("id", conversationId);

  if (updateError) {
    console.warn(
      "Conversation timestamp update skipped:",
      updateError.message
    );
  }

  return data;
}

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

async function getUserConversations(user) {
  const {
    data: buyerConversations,
    error: buyerError
  } = await supabase
    .from("chat_conversations")
    .select("*")
    .eq("buyer_id", user.id)
    .order("updated_at", {
      ascending: false
    });

  if (buyerError) {
    throw buyerError;
  }

  const {
    data: sellerConversations,
    error: sellerError
  } = await supabase
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

async function customerCareConversation(user) {
  const {
    data,
    error
  } = await supabase
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

async function customerCareAI(message) {
  const text = clean(message);

  if (!text) {
    return "Please enter your question and I will be happy to help.";
  }

  const OPENAI_API_KEY =
    Netlify.env.get("OPENAI_API_KEY");

  /*
   * If OpenAI is configured, use it.
   */
  if (OPENAI_API_KEY) {
    try {
      const response = await fetch(
        "https://api.openai.com/v1/responses",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization":
              `Bearer ${OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model:
              Netlify.env.get("OPENAI_MODEL") ||
              "gpt-5-mini",
            input: [
              {
                role: "system",
                content:
                  "You are SALGA Digital Mart customer care. Help buyers and sellers with marketplace questions, accounts, products, orders, payments, promotions, commissions and general support. Be concise, friendly and professional. Never invent payment confirmations or claim an order was completed unless the system confirms it."
              },
              {
                role: "user",
                content: text
              }
            ]
          })
        }
      );

      if (response.ok) {
        const data = await response.json();

        const answer =
          data.output_text ||
          data.output?.flatMap(
            item => item.content || []
          )
          .map(item => item.text || "")
          .join(" ")
          .trim();

        if (answer) {
          return answer;
        }
      }

      console.warn(
        "AI response failed; using fallback customer care."
      );

    } catch (error) {
      console.warn(
        "AI CUSTOMER CARE ERROR:",
        error
      );
    }
  }

  /*
   * Safe fallback when AI is not configured.
   */
  const lower = text.toLowerCase();

  if (
    lower.includes("payment") ||
    lower.includes("paystack") ||
    lower.includes("transfer")
  ) {
    return "For payment issues, please check that your payment was completed successfully. If money was deducted but your order was not confirmed, please contact SALGA Customer Care with your order details.";
  }

  if (
    lower.includes("order") ||
    lower.includes("delivery")
  ) {
    return "For an order or delivery issue, please provide your order details through Customer Care so the support team can check it.";
  }

  if (
    lower.includes("seller") ||
    lower.includes("business") ||
    lower.includes("product")
  ) {
    return "Business owners can manage their business profile, upload products and communicate with customers through the marketplace.";
  }

  if (
    lower.includes("promotion") ||
    lower.includes("advert")
  ) {
    return "SALGA Digital Mart charges a 3% commission on promotion and advertising transactions.";
  }

  if (
    lower.includes("commission")
  ) {
    return "The marketplace transaction commission is 5%. Promotion and advertising transactions carry a 3% commission.";
  }

  if (
    lower.includes("chat") ||
    lower.includes("message")
  ) {
    return "You can use the marketplace chat system to communicate with buyers, sellers and Customer Care after logging in.";
  }

  return "Thanks for contacting SALGA Digital Mart Customer Care. Please tell me what you need help with, and we will assist you.";
}

export default async function handler(request) {
  if (request.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers
    });
  }

  try {
    const user =
      await getUser(request);

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

    const queryAction =
      clean(
        url.searchParams.get("action")
      ).toLowerCase();

    /*
     * GET
     */
    if (request.method === "GET") {

      if (
        queryAction === "messages" ||
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

      if (
        queryAction === "conversations" ||
        queryAction === "list"
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

      if (
        queryAction === "customer_care"
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
     * POST
     */
    if (request.method === "POST") {

      const body =
        await request.json();

      const requestedAction =
        clean(
          body.action ||
          queryAction
        ).toLowerCase();

      /*
       * CUSTOMER CARE AI
       *
       * Supports:
       * customer_care_ai
       * customer-care-ai
       * ai
       */
      if (
        requestedAction ===
          "customer_care_ai" ||
        requestedAction ===
          "customer-care-ai" ||
        requestedAction === "ai"
      ) {
        const answer =
          await customerCareAI(
            body.message ||
            body.text ||
            body.question
          );

        return json({
          ok: true,
          answer,
          message: answer,
          reply: answer
        });
      }

      /*
       * CUSTOMER CARE CONVERSATION
       */
      if (
        requestedAction ===
          "customer_care"
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

      /*
       * SEND CUSTOMER CARE MESSAGE
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

        const messages =
          await getMessages(
            conversationId
          );

        return json({
          ok: true,
          message,
          messages,
          conversation_id:
            conversationId
        });
      }

      /*
       * CREATE/FIND CONVERSATION
       */
      if (
        requestedAction ===
          "create_conversation" ||
        requestedAction ===
          "conversation"
      ) {

        const buyerId =
          body.buyer_id ||
          (
            body.sender_role ===
            "buyer"
              ? user.id
              : null
          );

        const sellerId =
          body.seller_id;

        if (!buyerId) {
          return json(
            {
              ok: false,
              error:
                "buyer_id is required."
            },
            400
          );
        }

        if (!sellerId) {
          return json(
            {
              ok: false,
              error:
                "seller_id is required."
            },
            400
          );
        }

        const conversation =
          await getOrCreateConversation({
            buyerId,
            sellerId,
            businessId:
              body.business_id
          });

        return json({
          ok: true,
          conversation
        });
      }

      /*
       * GET MESSAGES THROUGH POST
       *
       * Some versions of the frontend
       * use:
       *
       * action: "messages"
       */
      if (
        requestedAction ===
          "messages" ||
        requestedAction ===
          "get_messages"
      ) {

        const conversationId =
          clean(
            body.conversation_id
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
       * NORMAL SEND MESSAGE
       *
       * Supports:
       * send
       * message
       * send_message
       * sendMessage
       * empty action
       */
      if (
        requestedAction === "send" ||
        requestedAction === "message" ||
        requestedAction ===
          "send_message" ||
        requestedAction ===
          "sendmessage" ||
        requestedAction === ""
      ) {

        let conversationId =
          clean(
            body.conversation_id ||
            body.conversationId
          );

        /*
         * Automatically create a
         * buyer/seller conversation
         * when possible.
         */
        if (!conversationId) {

          const sellerId =
            body.seller_id ||
            body.sellerId;

          const businessId =
            body.business_id ||
            body.businessId;

          if (sellerId) {

            const conversation =
              await getOrCreateConversation({
                buyerId:
                  body.buyer_id ||
                  body.buyerId ||
                  user.id,

                sellerId,

                businessId
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
         * Never trust the client
         * to provide another user's
         * sender ID.
         */
        const senderRole =
          clean(
            body.sender_role ||
            body.senderRole
          ).toLowerCase();

        let safeRole =
          "buyer";

        if (
          senderRole === "seller"
        ) {
          safeRole = "seller";
        }

        if (
          senderRole === "admin"
        ) {
          safeRole = "admin";
        }

        if (
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

        const messages =
          await getMessages(
            conversationId
          );

        return json({
          ok: true,
          message,
          messages,
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
