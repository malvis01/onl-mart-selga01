import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const ADMIN_EMAIL = "malvisdabz@gmail.com";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization",
  "Access-Control-Allow-Methods":
    "GET, POST, PATCH, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
  });
}

function createSupabase() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "Supabase server environment variables are missing."
    );
  }

  return createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

/**
 * Normalize account roles used by the platform.
 */
function normalizeRole(role) {
  const value = String(role || "")
    .trim()
    .toLowerCase();

  if (
    value === "seller" ||
    value === "business" ||
    value === "business_owner" ||
    value === "business-owner"
  ) {
    return "seller";
  }

  if (value === "admin") {
    return "admin";
  }

  return "buyer";
}

/**
 * Admin is identified server-side by email.
 */
function getRole(user) {
  const email = String(user?.email || "")
    .trim()
    .toLowerCase();

  if (
    email &&
    email === ADMIN_EMAIL.toLowerCase()
  ) {
    return "admin";
  }

  return normalizeRole(
    user?.app_metadata?.role ||
      user?.user_metadata?.role ||
      "buyer"
  );
}

/**
 * Get the authenticated Supabase user.
 */
async function getUser(req, db) {
  const authorization =
    req.headers.get("Authorization") || "";

  if (!authorization.startsWith("Bearer ")) {
    return null;
  }

  const token = authorization
    .slice(7)
    .trim();

  if (!token) {
    return null;
  }

  const {
    data,
    error,
  } = await db.auth.getUser(token);

  if (error || !data?.user) {
    return null;
  }

  return data.user;
}

/**
 * Verify that the current user belongs
 * to the requested conversation.
 *
 * Admin can access admin-involved conversations.
 */
function canAccessConversation(
  conversation,
  user,
  role
) {
  if (!conversation || !user) {
    return false;
  }

  if (role === "admin") {
    return Boolean(
      conversation.admin_involved
    );
  }

  return (
    String(conversation.buyer_id || "") ===
      String(user.id) ||
    String(conversation.seller_id || "") ===
      String(user.id)
  );
}

/**
 * Clean text sent by users.
 */
function cleanMessage(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, 5000);
}

function cleanId(value) {
  return String(value || "").trim();
}

/**
 * Load one conversation.
 *
 * NOTE:
 * conversation IDs in the existing database
 * are BIGINT, not UUID.
 */
async function getConversation(
  db,
  conversationId
) {
  const {
    data,
    error,
  } = await db
    .from("chat_conversations")
    .select("*")
    .eq("id", conversationId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
}

/**
 * Update conversation activity time.
 */
async function touchConversation(
  db,
  conversationId
) {
  const {
    error,
  } = await db
    .from("chat_conversations")
    .update({
      updated_at:
        new Date().toISOString(),
    })
    .eq("id", conversationId);

  if (error) {
    console.error(
      "CHAT CONVERSATION UPDATE ERROR:",
      error
    );
  }
}

/**
 * Find an existing conversation between
 * two participants.
 */
async function findConversation(
  db,
  user,
  role,
  targetId,
  targetRole
) {
  let query = db
    .from("chat_conversations")
    .select("*");

  /*
   * BUYER -> SELLER
   */
  if (
    role === "buyer" &&
    targetRole === "seller"
  ) {
    const {
      data,
      error,
    } = await query
      .eq("buyer_id", user.id)
      .eq("seller_id", targetId)
      .eq("admin_involved", false)
      .maybeSingle();

    if (error) throw error;

    return data || null;
  }

  /*
   * SELLER -> BUYER
   */
  if (
    role === "seller" &&
    targetRole === "buyer"
  ) {
    const {
      data,
      error,
    } = await query
      .eq("buyer_id", targetId)
      .eq("seller_id", user.id)
      .eq("admin_involved", false)
      .maybeSingle();

    if (error) throw error;

    return data || null;
  }

  /*
   * BUYER -> ADMIN
   *
   * One support conversation per buyer.
   */
  if (
    role === "buyer" &&
    targetRole === "admin"
  ) {
    const {
      data,
      error,
    } = await query
      .eq("buyer_id", user.id)
      .is("seller_id", null)
      .eq("admin_involved", true)
      .maybeSingle();

    if (error) throw error;

    return data || null;
  }

  /*
   * SELLER -> ADMIN
   *
   * One support conversation per seller.
   */
  if (
    role === "seller" &&
    targetRole === "admin"
  ) {
    const {
      data,
      error,
    } = await query
      .is("buyer_id", null)
      .eq("seller_id", user.id)
      .eq("admin_involved", true)
      .maybeSingle();

    if (error) throw error;

    return data || null;
  }

  /*
   * ADMIN -> BUYER
   */
  if (
    role === "admin" &&
    targetRole === "buyer"
  ) {
    const {
      data,
      error,
    } = await query
      .eq("buyer_id", targetId)
      .is("seller_id", null)
      .eq("admin_involved", true)
      .maybeSingle();

    if (error) throw error;

    return data || null;
  }

  /*
   * ADMIN -> SELLER
   */
  if (
    role === "admin" &&
    targetRole === "seller"
  ) {
    const {
      data,
      error,
    } = await query
      .is("buyer_id", null)
      .eq("seller_id", targetId)
      .eq("admin_involved", true)
      .maybeSingle();

    if (error) throw error;

    return data || null;
  }

  return null;
}

/**
 * Create a new conversation.
 */
async function createConversation(
  db,
  user,
  role,
  targetId,
  targetRole
) {
  let buyerId = null;
  let sellerId = null;
  let adminInvolved = false;

  /*
   * Buyer -> Seller
   */
  if (
    role === "buyer" &&
    targetRole === "seller"
  ) {
    buyerId = user.id;
    sellerId = targetId;
  }

  /*
   * Seller -> Buyer
   */
  else if (
    role === "seller" &&
    targetRole === "buyer"
  ) {
    buyerId = targetId;
    sellerId = user.id;
  }

  /*
   * Buyer -> Admin
   */
  else if (
    role === "buyer" &&
    targetRole === "admin"
  ) {
    buyerId = user.id;
    adminInvolved = true;
  }

  /*
   * Seller -> Admin
   */
  else if (
    role === "seller" &&
    targetRole === "admin"
  ) {
    sellerId = user.id;
    adminInvolved = true;
  }

  /*
   * Admin -> Buyer
   */
  else if (
    role === "admin" &&
    targetRole === "buyer"
  ) {
    buyerId = targetId;
    adminInvolved = true;
  }

  /*
   * Admin -> Seller
   */
  else if (
    role === "admin" &&
    targetRole === "seller"
  ) {
    sellerId = targetId;
    adminInvolved = true;
  }

  else {
    throw new Error(
      "Invalid conversation participants."
    );
  }

  const {
    data,
    error,
  } = await db
    .from("chat_conversations")
    .insert({
      buyer_id: buyerId,
      seller_id: sellerId,
      admin_involved:
        adminInvolved,
    })
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Save a message.
 */
async function createMessage(
  db,
  conversationId,
  user,
  role,
  message
) {
  const {
    data,
    error,
  } = await db
    .from("chat_messages")
    .insert({
      conversation_id:
        conversationId,
      sender_id: user.id,
      sender_role: role,
      message,
    })
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  await touchConversation(
    db,
    conversationId
  );

  return data;
}

export default async function handler(req) {
  /*
   * CORS
   */
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers,
    });
  }

  try {
    const db = createSupabase();

    /*
     * Authentication
     */
    const user = await getUser(
      req,
      db
    );

    if (!user) {
      return json(
        {
          success: false,
          error:
            "Please log in before using chat.",
        },
        401
      );
    }

    const role = getRole(user);

    /*
     * ======================================
     * GET
     * ======================================
     *
     * GET /api/chat
     *
     * Returns conversations.
     *
     * GET /api/chat?conversation_id=123
     *
     * Returns conversation + messages.
     */
    if (req.method === "GET") {
      const url = new URL(req.url);

      const conversationId =
        cleanId(
          url.searchParams.get(
            "conversation_id"
          )
        );

      /*
       * --------------------------------------
       * Single conversation
       * --------------------------------------
       */
      if (conversationId) {
        const conversation =
          await getConversation(
            db,
            conversationId
          );

        if (!conversation) {
          return json(
            {
              success: false,
              error:
                "Conversation not found.",
            },
            404
          );
        }

        if (
          !canAccessConversation(
            conversation,
            user,
            role
          )
        ) {
          return json(
            {
              success: false,
              error:
                "You are not allowed to access this conversation.",
            },
            403
          );
        }

        const {
          data: messages,
          error,
        } = await db
          .from("chat_messages")
          .select("*")
          .eq(
            "conversation_id",
            conversationId
          )
          .order("created_at", {
            ascending: true,
          });

        if (error) {
          throw error;
        }

        /*
         * Mark messages sent by other users
         * as read.
         */
        await db
          .from("chat_messages")
          .update({
            read_at:
              new Date().toISOString(),
          })
          .eq(
            "conversation_id",
            conversationId
          )
          .neq(
            "sender_id",
            user.id
          )
          .is(
            "read_at",
            null
          );

        return json({
          success: true,
          conversation,
          messages:
            messages || [],
        });
      }

      /*
       * --------------------------------------
       * Conversation list
       * --------------------------------------
       */
      let query = db
        .from("chat_conversations")
        .select("*")
        .order("updated_at", {
          ascending: false,
        });

      /*
       * Buyer sees conversations
       * belonging to buyer.
       */
      if (role === "buyer") {
        query = query.eq(
          "buyer_id",
          user.id
        );
      }

      /*
       * Seller sees conversations
       * belonging to seller.
       */
      else if (role === "seller") {
        query = query.eq(
          "seller_id",
          user.id
        );
      }

      /*
       * Admin sees ALL admin conversations.
       */
      else if (role === "admin") {
        query = query.eq(
          "admin_involved",
          true
        );
      }

      const {
        data: conversations,
        error,
      } = await query;

      if (error) {
        throw error;
      }

      return json({
        success: true,
        conversations:
          conversations || [],
      });
    }

    /*
     * ======================================
     * POST
     * ======================================
     *
     * Create/open conversation.
     *
     * Body:
     * {
     *   target_id: "USER_ID",
     *   target_role: "seller",
     *   message: "Hello"
     * }
     */
    if (req.method === "POST") {
      let body;

      try {
        body = await req.json();
      } catch {
        return json(
          {
            success: false,
            error:
              "Invalid JSON request body.",
          },
          400
        );
      }

      const targetId =
        cleanId(
          body?.target_id
        );

      const targetRole =
        normalizeRole(
          body?.target_role
        );

      const firstMessage =
        cleanMessage(
          body?.message
        );

      if (!targetId) {
        return json(
          {
            success: false,
            error:
              "Chat recipient is required.",
          },
          400
        );
      }

      if (
        ![
          "buyer",
          "seller",
          "admin",
        ].includes(targetRole)
      ) {
        return json(
          {
            success: false,
            error:
              "Invalid recipient role.",
          },
          400
        );
      }

      if (targetRole === role) {
        return json(
          {
            success: false,
            error:
              "You cannot start a conversation with yourself.",
          },
          400
        );
      }

      /*
       * Find existing conversation first.
       */
      let conversation =
        await findConversation(
          db,
          user,
          role,
          targetId,
          targetRole
        );

      /*
       * Create if necessary.
       */
      if (!conversation) {
        conversation =
          await createConversation(
            db,
            user,
            role,
            targetId,
            targetRole
          );
      }

      /*
       * Optional first message.
       */
      let savedMessage = null;

      if (firstMessage) {
        savedMessage =
          await createMessage(
            db,
            conversation.id,
            user,
            role,
            firstMessage
          );
      }

      return json(
        {
          success: true,
          conversation,
          message:
            savedMessage,
        },
        201
      );
    }

    /*
     * ======================================
     * PATCH
     * ======================================
     *
     * Send message.
     *
     * Body:
     * {
     *   conversation_id: 123,
     *   message: "Hello"
     * }
     */
    if (req.method === "PATCH") {
      let body;

      try {
        body = await req.json();
      } catch {
        return json(
          {
            success: false,
            error:
              "Invalid JSON request body.",
          },
          400
        );
      }

      const conversationId =
        cleanId(
          body?.conversation_id
        );

      const message =
        cleanMessage(
          body?.message
        );

      if (!conversationId) {
        return json(
          {
            success: false,
            error:
              "Conversation ID is required.",
          },
          400
        );
      }

      if (!message) {
        return json(
          {
            success: false,
            error:
              "Message cannot be empty.",
          },
          400
        );
      }

      /*
       * Load conversation.
       */
      const conversation =
        await getConversation(
          db,
          conversationId
        );

      if (!conversation) {
        return json(
          {
            success: false,
            error:
              "Conversation not found.",
          },
          404
        );
      }

      /*
       * Security check.
       */
      if (
        !canAccessConversation(
          conversation,
          user,
          role
        )
      ) {
        return json(
          {
            success: false,
            error:
              "You are not allowed to send messages in this conversation.",
          },
          403
        );
      }

      /*
       * Save message.
       */
      const savedMessage =
        await createMessage(
          db,
          conversationId,
          user,
          role,
          message
        );

      return json({
        success: true,
        message:
          savedMessage,
      });
    }

    /*
     * ======================================
     * Unsupported method
     * ======================================
     */
    return json(
      {
        success: false,
        error:
          "Method not allowed.",
      },
      405
    );
  } catch (error) {
    console.error(
      "SALGA CHAT ERROR:",
      error
    );

    return json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Chat request failed.",
      },
      500
    );
  }
}

export const config = {
  path: "/api/chat",
};
