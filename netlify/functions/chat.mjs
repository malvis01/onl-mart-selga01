import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  Netlify.env.get("SUPABASE_URL") ||
  Netlify.env.get("VITE_SUPABASE_URL");

const SUPABASE_SERVICE_ROLE_KEY =
  Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json"
    }
  });

const clean = value => String(value ?? "").trim();

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "chat.mjs: Supabase server environment variables are missing"
  );
}

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY,
        {
          auth: {
            autoRefreshToken: false,
            persistSession: false
          }
        }
      )
    : null;

async function getUser(request) {
  if (!supabase) return null;

  const authorization =
    request.headers.get("authorization") || "";

  if (!/^bearer\s+/i.test(authorization)) {
    return null;
  }

  const token = authorization
    .replace(/^bearer\s+/i, "")
    .trim();

  if (!token) return null;

  const {
    data,
    error
  } = await supabase.auth.getUser(token);

  if (error || !data?.user) {
    console.error(
      "CHAT AUTH ERROR",
      error?.message || error
    );

    return null;
  }

  return data.user;
}

async function getMessages(conversationId) {
  if (!conversationId) {
    throw new Error(
      "conversation_id is required."
    );
  }

  const {
    data,
    error
  } = await supabase
    .from("messages")
    .select("*")
    .eq(
      "conversation_id",
      conversationId
    )
    .order("created_at", {
      ascending: true
    });

  if (error) throw error;

  return data || [];
}

async function getConversation(
  id,
  userId
) {
  if (!id) return null;

  const {
    data,
    error
  } = await supabase
    .from("chat_conversations")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;

  if (!data) return null;

  if (
    data.buyer_id !== userId &&
    data.seller_id !== userId
  ) {
    return null;
  }

  return data;
}

async function getOrCreateConversation({
  buyerId,
  sellerId,
  businessId
}) {
  if (!buyerId || !sellerId) {
    throw new Error(
      "buyer_id and seller_id are required."
    );
  }

  let query = supabase
    .from("chat_conversations")
    .select("*")
    .eq("buyer_id", buyerId)
    .eq("seller_id", sellerId)
    .order("updated_at", {
      ascending: false
    })
    .limit(1);

  if (businessId) {
    query = query.eq(
      "business_id",
      businessId
    );
  }

  const {
    data: existing,
    error
  } = await query;

  if (error) throw error;

  if (existing?.length) {
    return existing[0];
  }

  const row = {
    buyer_id: buyerId,
    seller_id: sellerId
  };

  if (businessId) {
    row.business_id = businessId;
  }

  const {
    data,
    error: insertError
  } = await supabase
    .from("chat_conversations")
    .insert(row)
    .select("*")
    .single();

  if (insertError) {
    throw insertError;
  }

  return data;
}

async function customerCareConversation(
  userId
) {
  const {
    data,
    error
  } = await supabase
    .from("chat_conversations")
    .select("*")
    .eq("buyer_id", userId)
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
      buyer_id: userId,
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

async function listConversations(
  userId
) {
  const [
    buyerResult,
    sellerResult
  ] = await Promise.all([
    supabase
      .from("chat_conversations")
      .select("*")
      .eq("buyer_id", userId),

    supabase
      .from("chat_conversations")
      .select("*")
      .eq("seller_id", userId)
  ]);

  if (buyerResult.error) {
    throw buyerResult.error;
  }

  if (sellerResult.error) {
    throw sellerResult.error;
  }

  const map = new Map();

  for (
    const row of [
      ...(buyerResult.data || []),
      ...(sellerResult.data || [])
    ]
  ) {
    map.set(row.id, row);
  }

  return [...map.values()].sort(
    (a, b) =>
      new Date(
        b.updated_at ||
        b.created_at ||
        0
      ) -
      new Date(
        a.updated_at ||
        a.created_at ||
        0
      )
  );
}

async function sendMessage({
  conversationId,
  user,
  message,
  senderRole
}) {
  const text = clean(message);

  if (!text) {
    throw new Error(
      "Message cannot be empty."
    );
  }

  const conversation =
    await getConversation(
      conversationId,
      user.id
    );

  if (!conversation) {
    throw new Error(
      "Conversation not found or access denied."
    );
  }

  const role =
    clean(senderRole) ||
    (
      conversation.buyer_id === user.id
        ? "buyer"
        : "seller"
    );

  const {
    data,
    error
  } = await supabase
    .from("messages")
    .insert({
      conversation_id:
        conversation.id,

      sender_id:
        user.id,

      sender_role:
        role,

      message:
        text
    })
    .select("*")
    .single();

  if (error) throw error;

  await supabase
    .from("chat_conversations")
    .update({
      updated_at:
        new Date().toISOString()
    })
    .eq(
      "id",
      conversation.id
    );

  return {
    message: data,
    conversation_id:
      conversation.id
  };
}

async function aiReply(message) {
  const text = clean(message);

  if (!text) {
    return "Please enter your question and I will be happy to help.";
  }

  const key =
    Netlify.env.get(
      "OPENAI_API_KEY"
    );

  if (key) {
    try {
      const response =
        await fetch(
          "https://api.openai.com/v1/responses",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",

              Authorization:
                `Bearer ${key}`
            },

            body: JSON.stringify({
              model:
                Netlify.env.get(
                  "OPENAI_MODEL"
                ) ||
                "gpt-5-mini",

              input: [
                {
                  role: "system",

                  content:
                    "You are SALGA Digital Mart Customer Care. Help buyers and sellers with accounts, products, orders, payments, delivery, promotions, commissions and chat. Be concise, friendly and practical. Never claim a payment, refund, payout, order or account change was completed unless the system confirms it. Marketplace transaction commission is 5%; promotion/advertising commission is 3%."
                },

                {
                  role: "user",

                  content:
                    text.slice(
                      0,
                      4000
                    )
                }
              ]
            })
          }
        );

      if (response.ok) {
        const data =
          await response.json();

        const answer =
          clean(
            data.output_text ||
            (data.output || [])
              .flatMap(
                item =>
                  item.content || []
              )
              .map(
                item =>
                  item.text || ""
              )
              .join(" ")
          );

        if (answer) {
          return answer;
        }
      }
    } catch (error) {
      console.warn(
        "AI CUSTOMER CARE ERROR",
        error
      );
    }
  }

  const lower =
    text.toLowerCase();

  if (
    lower.includes(
      "commission"
    )
  ) {
    return "SALGA Digital Mart charges 5% on marketplace transactions and 3% on promotion and advertising transactions.";
  }

  if (
    lower.includes("payment") ||
    lower.includes("paystack") ||
    lower.includes("transfer")
  ) {
    return "If you have a payment problem, please keep your transaction reference. If money was deducted but the order was not confirmed, contact Customer Care with the order details.";
  }

  if (
    lower.includes("order") ||
    lower.includes("delivery")
  ) {
    return "Please provide your order details in Customer Care so the support team can check the order and delivery status.";
  }

  if (
    lower.includes("seller") ||
    lower.includes("business") ||
    lower.includes("product")
  ) {
    return "Business owners can manage their profile, upload products and communicate with customers through SALGA Digital Mart.";
  }

  return "Thanks for contacting SALGA Digital Mart Customer Care. Please tell me what you need help with, and we will assist you.";
}

function normalizeAction(
  body,
  url
) {
  const raw =
    clean(
      body?.action ||
      body?.type ||
      url.searchParams.get(
        "action"
      )
    ).toLowerCase();

  const aliases = {

    get_messages:
      "messages",

    getmessages:
      "messages",

    fetch_messages:
      "messages",

    load_messages:
      "messages",

    send_message:
      "send",

    sendmessage:
      "send",

    create_message:
      "send",

    start_conversation:
      "create_conversation",

    create_chat:
      "create_conversation",

    createchat:
      "create_conversation",

    get_conversations:
      "conversations",

    getconversations:
      "conversations",

    list_conversations:
      "conversations",

    customer_care_chat:
      "customer_care",

    contact_customer_care:
      "customer_care",

    contact_platform_customer_care:
      "customer_care",

    customer_care_message:
      "customer_care_send",

    send_customer_care:
      "customer_care_send",

    send_customer_care_message:
      "customer_care_send",

    customer_care_ai:
      "ai",

    customer_care_ai_message:
      "ai",

    "customer-care-ai":
      "ai"
  };

  return (
    aliases[raw] ||
    raw
  );
}

export default async function handler(
  request
) {
  if (
    request.method ===
    "OPTIONS"
  ) {
    return new Response(
      "ok",
      {
        status: 200,
        headers
      }
    );
  }

  if (!supabase) {
    return json(
      {
        ok: false,
        error:
          "Supabase server environment variables are missing."
      },
      500
    );
  }

  try {
    const url =
      new URL(request.url);

    let body = {};

    if (
      request.method ===
      "POST"
    ) {
      try {
        body =
          await request.json();
      } catch {
        body = {};
      }
    }

    const action =
      normalizeAction(
        body,
        url
      );

    const user =
      await getUser(
        request
      );

    if (!user) {
      return json(
        {
          ok: false,
          error:
            "Login required."
        },
        401
      );
    }

    /*
     * GET
     */

    if (
      request.method ===
      "GET"
    ) {

      if (
        action ===
          "messages" ||
        url.searchParams.has(
          "conversation_id"
        )
      ) {

        const conversation =
          await getConversation(
            url.searchParams.get(
              "conversation_id"
            ),
            user.id
          );

        if (!conversation) {
          return json(
            {
              ok: false,
              error:
                "Conversation not found or access denied."
            },
            404
          );
        }

        return json({
          ok: true,
          conversation,

          messages:
            await getMessages(
              conversation.id
            )
        });
      }

      if (
        action ===
        "customer_care"
      ) {

        const conversation =
          await customerCareConversation(
            user.id
          );

        return json({
          ok: true,
          conversation,

          messages:
            await getMessages(
              conversation.id
            )
        });
      }

      return json({
        ok: true,

        conversations:
          await listConversations(
            user.id
          )
      });
    }

    /*
     * Only POST after this point
     */

    if (
      request.method !==
      "POST"
    ) {
      return json(
        {
          ok: false,
          error:
            "Method not allowed."
        },
        405
      );
    }

    /*
     * AI CUSTOMER CARE
     */

    if (
      action ===
      "ai"
    ) {

      const answer =
        await aiReply(
          body.message ||
          body.text ||
          body.question
        );

      return json({
        ok: true,
        answer,
        reply: answer,
        message: answer
      });
    }

    /*
     * OPEN CUSTOMER CARE
     */

    if (
      action ===
      "customer_care"
    ) {

      const conversation =
        await customerCareConversation(
          user.id
        );

      return json({
        ok: true,
        conversation,

        messages:
          await getMessages(
            conversation.id
          )
      });
    }

    /*
     * SEND CUSTOMER CARE MESSAGE
     */

    if (
      action ===
      "customer_care_send"
    ) {

      let conversationId =
        clean(
          body.conversation_id
        );

      if (!conversationId) {

        conversationId =
          (
            await customerCareConversation(
              user.id
            )
          ).id;
      }

      const result =
        await sendMessage({
          conversationId,
          user,

          message:
            body.message ||
            body.text,

          senderRole:
            "customer"
        });

      return json({
        ok: true,
        ...result,

        messages:
          await getMessages(
            conversationId
          )
      });
    }

    /*
     * GET MESSAGES
     */

    if (
      action ===
      "messages"
    ) {

      const conversation =
        await getConversation(
          body.conversation_id,
          user.id
        );

      if (!conversation) {
        return json(
          {
            ok: false,
            error:
              "Conversation not found or access denied."
          },
          404
        );
      }

      return json({
        ok: true,
        conversation,

        messages:
          await getMessages(
            conversation.id
          )
      });
    }

    /*
     * LIST CONVERSATIONS
     */

    if (
      action ===
        "conversations" ||
      action ===
        "list" ||
      action === ""
    ) {

      return json({
        ok: true,

        conversations:
          await listConversations(
            user.id
          )
      });
    }

    /*
     * CREATE/FIND CHAT
     */

    if (
      action ===
        "create_conversation" ||
      action ===
        "conversation"
    ) {

      let buyerId =
        clean(
          body.buyer_id
        );

      let sellerId =
        clean(
          body.seller_id
        );

      const role =
        clean(
          body.sender_role ||
          body.role
        ).toLowerCase();

      if (
        !buyerId &&
        role === "buyer"
      ) {
        buyerId =
          user.id;
      }

      if (
        !sellerId &&
        role === "seller"
      ) {
        sellerId =
          user.id;
      }

      if (
        !buyerId ||
        !sellerId
      ) {
        return json(
          {
            ok: false,
            error:
              "buyer_id and seller_id are required."
          },
          400
        );
      }

      if (
        buyerId !== user.id &&
        sellerId !== user.id
      ) {
        return json(
          {
            ok: false,
            error:
              "You are not a participant in this conversation."
          },
          403
        );
      }

      const conversation =
        await getOrCreateConversation({
          buyerId,
          sellerId,

          businessId:
            clean(
              body.business_id
            ) || null
        });

      return json({
        ok: true,
        conversation,

        messages:
          await getMessages(
            conversation.id
          )
      });
    }

    /*
     * SEND NORMAL BUYER/SELLER MESSAGE
     */

    if (
      action ===
      "send"
    ) {

      let conversationId =
        clean(
          body.conversation_id ||
          body.conversationId
        );

      /*
       * If no conversation ID was supplied,
       * create/find one from buyer and seller IDs.
       */

      if (
        !conversationId &&
        (
          body.buyer_id ||
          body.seller_id
        )
      ) {

        let buyerId =
          clean(
            body.buyer_id
          ) ||
          user.id;

        let sellerId =
          clean(
            body.seller_id
          ) ||
          user.id;

        if (
          buyerId ===
          sellerId
        ) {
          return json(
            {
              ok: false,
              error:
                "Buyer and seller cannot be the same user."
            },
            400
          );
        }

        if (
          user.id !== buyerId &&
          user.id !== sellerId
        ) {
          return json(
            {
              ok: false,
              error:
                "You are not a participant in this conversation."
            },
            403
          );
        }

        conversationId =
          (
            await getOrCreateConversation({
              buyerId,
              sellerId,

              businessId:
                clean(
                  body.business_id
                ) || null
            })
          ).id;
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

      const result =
        await sendMessage({
          conversationId,
          user,

          message:
            body.message ||
            body.text,

          senderRole:
            body.sender_role ||
            body.role
        });

      return json({
        ok: true,
        ...result,

        messages:
          await getMessages(
            conversationId
          )
      });
    }

    /*
     * IMPORTANT:
     * This now accepts many aliases instead of
     * immediately failing with "Unknown chat action".
     */

    return json(
      {
        ok: false,
        error:
          `Unknown chat action: ${
            action || "(empty)"
          }.`
      },
      400
    );

  } catch (error) {

    console.error(
      "CHAT FUNCTION ERROR",
      error
    );

    return json(
      {
        ok: false,
        error:
          error?.message ||
          "Chat service error."
      },
      500
    );
  }
}

export const config = {
  path: "/api/chat"
};
