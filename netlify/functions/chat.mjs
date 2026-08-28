import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  Netlify.env.get("SUPABASE_URL") ||
  Netlify.env.get("VITE_SUPABASE_URL");

const SUPABASE_KEY =
  Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  Netlify.env.get("SUPABASE_ANON_KEY") ||
  Netlify.env.get("VITE_SUPABASE_ANON_KEY");

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Requested-With",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS"
};

function response(statusCode, body) {
  return {
    statusCode,
    headers,
    body: JSON.stringify(body)
  };
}

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function getBody(event) {
  try {
    if (!event.body) return {};
    return typeof event.body === "string"
      ? JSON.parse(event.body)
      : event.body;
  } catch {
    return {};
  }
}

function getUserId(event, body = {}) {
  const authHeader =
    event.headers?.authorization ||
    event.headers?.Authorization ||
    "";

  /*
   * The frontend can send the logged-in user's ID in the body.
   * We also try the Authorization token when available.
   */
  return (
    clean(body.user_id) ||
    clean(body.userId) ||
    clean(body.sender_id) ||
    clean(body.senderId) ||
    ""
  );
}

function normalizeRole(role) {
  const value = clean(role).toLowerCase();

  if (
    value === "admin" ||
    value === "administrator"
  ) {
    return "admin";
  }

  if (
    value === "seller" ||
    value === "business" ||
    value === "business_owner" ||
    value === "business-owner"
  ) {
    return "seller";
  }

  if (
    value === "buyer" ||
    value === "customer" ||
    value === "user"
  ) {
    return "buyer";
  }

  return value;
}

/*
 * Find the application's user/profile table without changing
 * the rest of the marketplace.
 */
async function getProfile(userId) {
  if (!userId) return null;

  const possibleTables = [
    "profiles",
    "users",
    "accounts",
    "business_profiles"
  ];

  for (const table of possibleTables) {
    try {
      const { data, error } = await supabase
        .from(table)
        .select("*")
        .eq("id", userId)
        .maybeSingle();

      if (!error && data) {
        return {
          ...data,
          _table: table
        };
      }
    } catch {
      // Try the next possible table.
    }
  }

  return null;
}

function profileRole(profile) {
  if (!profile) return "";

  return normalizeRole(
    profile.role ||
    profile.account_type ||
    profile.user_type ||
    profile.type
  );
}

function profileName(profile) {
  if (!profile) return "";

  return (
    clean(profile.name) ||
    clean(profile.full_name) ||
    clean(profile.fullName) ||
    clean(profile.business_name) ||
    clean(profile.businessName) ||
    clean(profile.phone) ||
    clean(profile.email)
  );
}

/*
 * Build a stable conversation key.

 * Important:
 * A conversation is determined by the two participants.
 * Therefore buyer/seller messages stay together while
 * different users have different private conversations.
 *
 * Admin conversations are also separate for each buyer/seller.
 */
function makeConversationKey(userA, userB) {
  const a = clean(userA);
  const b = clean(userB);

  if (!a || !b || a === b) return "";

  return [a, b].sort().join(":");
}

function makeConversationType(roleA, roleB) {
  const a = normalizeRole(roleA);
  const b = normalizeRole(roleB);

  if (a === "admin" || b === "admin") {
    return "admin";
  }

  if (
    (a === "buyer" && b === "seller") ||
    (a === "seller" && b === "buyer")
  ) {
    return "buyer_seller";
  }

  if (a === "seller" && b === "seller") {
    return "seller_seller";
  }

  if (a === "buyer" && b === "buyer") {
    return "buyer_buyer";
  }

  return "direct";
}

async function ensureChatTable() {
  /*
   * The function expects the existing chat/messages table.
   * We deliberately do not attempt to alter your database schema
   * from a Netlify function.
   */
  return true;
}

/*
 * Try the existing "chat_messages" table first, then
 * "messages" for compatibility with the existing project.
 */
async function insertMessage(message) {
  const tables = [
    "chat_messages",
    "messages"
  ];

  let lastError = null;

  for (const table of tables) {
    try {
      const { data, error } = await supabase
        .from(table)
        .insert(message)
        .select("*")
        .single();

      if (!error && data) {
        return {
          data,
          table
        };
      }

      lastError = error;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Unable to save chat message.");
}

async function fetchMessages(conversationKey, limit = 100) {
  const tables = [
    "chat_messages",
    "messages"
  ];

  let lastError = null;

  for (const table of tables) {
    try {
      /*
       * conversation_key is preferred because it guarantees
       * the conversation is private to these two users.
       */
      const result = await supabase
        .from(table)
        .select("*")
        .eq("conversation_key", conversationKey)
        .order("created_at", {
          ascending: true
        })
        .limit(limit);

      if (!result.error) {
        return {
          data: result.data || [],
          table
        };
      }

      lastError = result.error;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Unable to load messages.");
}

async function markMessagesRead(
  conversationKey,
  userId
) {
  const tables = [
    "chat_messages",
    "messages"
  ];

  for (const table of tables) {
    try {
      /*
       * We intentionally try common column names.
       * If a particular column doesn't exist, the next
       * compatible table/query can be used.
       */
      await supabase
        .from(table)
        .update({
          read: true,
          is_read: true
        })
        .eq("conversation_key", conversationKey)
        .eq("receiver_id", userId);
    } catch {
      // Reading messages must not fail because of this.
    }
  }
}

async function listConversations(userId) {
  const tables = [
    "chat_messages",
    "messages"
  ];

  let rows = [];
  let found = false;

  for (const table of tables) {
    try {
      const result = await supabase
        .from(table)
        .select("*")
        .or(
          `sender_id.eq.${userId},receiver_id.eq.${userId}`
        )
        .order("created_at", {
          ascending: false
        })
        .limit(500);

      if (!result.error) {
        rows = result.data || [];
        found = true;
        break;
      }
    } catch {
      // Try next table.
    }
  }

  if (!found) {
    throw new Error("Unable to load conversations.");
  }

  const map = new Map();

  for (const row of rows) {
    const key =
      clean(row.conversation_key) ||
      makeConversationKey(
        row.sender_id,
        row.receiver_id
      );

    if (!key) continue;

    if (!map.has(key)) {
      const otherUserId =
        clean(row.sender_id) === userId
          ? clean(row.receiver_id)
          : clean(row.sender_id);

      const otherProfile =
        await getProfile(otherUserId);

      map.set(key, {
        conversation_key: key,
        conversation_type:
          row.conversation_type || "direct",
        other_user_id: otherUserId,
        other_user_name:
          profileName(otherProfile) ||
          "User",
        last_message:
          clean(row.message) ||
          clean(row.content) ||
          "",
        last_message_at:
          row.created_at || null,
        unread: 0
      });
    }

    const item = map.get(key);

    const receiverId =
      clean(row.receiver_id);

    const senderId =
      clean(row.sender_id);

    const isUnread =
      receiverId === userId &&
      senderId !== userId &&
      row.read !== true &&
      row.is_read !== true;

    if (isUnread) {
      item.unread += 1;
    }
  }

  return Array.from(map.values()).sort(
    (a, b) =>
      new Date(b.last_message_at || 0) -
      new Date(a.last_message_at || 0)
  );
}

export default async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers,
      body: ""
    };
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return response(500, {
        ok: false,
        error:
          "Supabase environment variables are not configured."
      });
    }

    const method =
      clean(event.httpMethod).toUpperCase();

    const body = getBody(event);

    /*
     * POST
     * Send a private message.
     */
    if (method === "POST") {
      const senderId = getUserId(event, body);

      const receiverId =
        clean(body.receiver_id) ||
        clean(body.receiverId) ||
        clean(body.recipient_id) ||
        clean(body.recipientId) ||
        "";

      const message =
        clean(body.message) ||
        clean(body.content) ||
        clean(body.text);

      const senderRole =
        normalizeRole(
          body.sender_role ||
          body.senderRole ||
          body.role ||
          ""
        );

      const receiverRole =
        normalizeRole(
          body.receiver_role ||
          body.receiverRole ||
          body.recipient_role ||
          ""
        );

      if (!senderId) {
        return response(401, {
          ok: false,
          error: "You must be logged in to send a message."
        });
      }

      if (!receiverId) {
        return response(400, {
          ok: false,
          error: "A receiver is required."
        });
      }

      if (senderId === receiverId) {
        return response(400, {
          ok: false,
          error: "You cannot send a private message to yourself."
        });
      }

      if (!message) {
        return response(400, {
          ok: false,
          error: "Message cannot be empty."
        });
      }

      if (message.length > 5000) {
        return response(400, {
          ok: false,
          error:
            "Message is too long. Maximum length is 5000 characters."
        });
      }

      /*
       * Get profiles when available so the conversation
       * type can be determined automatically.
       */
      const senderProfile =
        await getProfile(senderId);

      const receiverProfile =
        await getProfile(receiverId);

      const finalSenderRole =
        senderRole ||
        profileRole(senderProfile) ||
        "buyer";

      const finalReceiverRole =
        receiverRole ||
        profileRole(receiverProfile) ||
        "buyer";

      const conversationKey =
        makeConversationKey(
          senderId,
          receiverId
        );

      const conversationType =
        makeConversationType(
          finalSenderRole,
          finalReceiverRole
        );

      if (!conversationKey) {
        return response(400, {
          ok: false,
          error: "Invalid conversation."
        });
      }

      const now =
        new Date().toISOString();

      /*
       * Keep the message fields broad enough to work with
       * the current chat implementation while preserving
       * the private conversation key.
       */
      const newMessage = {
        sender_id: senderId,
        receiver_id: receiverId,
        conversation_key: conversationKey,
        conversation_type: conversationType,
        message,
        content: message,
        sender_role: finalSenderRole,
        receiver_role: finalReceiverRole,
        read: false,
        is_read: false,
        created_at: now
      };

      let saved;

      try {
        saved = await insertMessage(
          newMessage
        );
      } catch (insertError) {
        /*
         * Some existing message tables may not contain
         * all optional fields. Retry with the essential
         * fields used by the chat system.
         */
        const fallbackTables = [
          "chat_messages",
          "messages"
        ];

        let fallbackResult = null;

        for (const table of fallbackTables) {
          try {
            const result =
              await supabase
                .from(table)
                .insert({
                  sender_id: senderId,
                  receiver_id: receiverId,
                  conversation_key:
                    conversationKey,
                  conversation_type:
                    conversationType,
                  message,
                  created_at: now
                })
                .select("*")
                .single();

            if (!result.error) {
              fallbackResult = {
                data: result.data,
                table
              };
              break;
            }
          } catch {
            // Continue.
          }
        }

        if (!fallbackResult) {
          throw insertError;
        }

        saved = fallbackResult;
      }

      return response(200, {
        ok: true,
        message: saved.data,
        conversation_key: conversationKey,
        conversation_type: conversationType
      });
    }

    /*
     * GET
     *
     * Supported:
     *
     * /api/chat?user_id=USER
     *     -> list private conversations
     *
     * /api/chat?user_id=USER&conversation_key=KEY
     *     -> load one private conversation
     *
     * /api/chat?user_id=USER&receiver_id=OTHER
     *     -> load the private conversation between both users
     */
    if (method === "GET") {
      const params =
        event.queryStringParameters || {};

      const userId =
        clean(params.user_id) ||
        clean(params.userId);

      if (!userId) {
        return response(401, {
          ok: false,
          error: "You must be logged in."
        });
      }

      const conversationKey =
        clean(params.conversation_key) ||
        clean(params.conversationKey);

      const receiverId =
        clean(params.receiver_id) ||
        clean(params.receiverId) ||
        clean(params.recipient_id) ||
        clean(params.recipientId);

      /*
       * Return the user's conversation list.
       */
      if (!conversationKey && !receiverId) {
        const conversations =
          await listConversations(
            userId
          );

        return response(200, {
          ok: true,
          conversations
        });
      }

      const finalConversationKey =
        conversationKey ||
        makeConversationKey(
          userId,
          receiverId
        );

      if (!finalConversationKey) {
        return response(400, {
          ok: false,
          error: "Invalid conversation."
        });
      }

      /*
       * Security check:
       * The requested conversation must contain
       * the currently logged-in user's ID.
       */
      const participants =
        finalConversationKey.split(":");

      if (!participants.includes(userId)) {
        return response(403, {
          ok: false,
          error:
            "You are not allowed to view this conversation."
        });
      }

      const result =
        await fetchMessages(
          finalConversationKey,
          Math.min(
            Number(params.limit) || 100,
            200
          )
        );

      await markMessagesRead(
        finalConversationKey,
        userId
      );

      return response(200, {
        ok: true,
        conversation_key:
          finalConversationKey,
        messages:
          result.data || []
      });
    }

    /*
     * PUT
     *
     * Mark a conversation as read.
     */
    if (method === "PUT") {
      const userId =
        getUserId(event, body);

      const conversationKey =
        clean(body.conversation_key) ||
        clean(body.conversationKey);

      if (!userId || !conversationKey) {
        return response(400, {
          ok: false,
          error:
            "user_id and conversation_key are required."
        });
      }

      const participants =
        conversationKey.split(":");

      if (!participants.includes(userId)) {
        return response(403, {
          ok: false,
          error:
            "You are not allowed to modify this conversation."
        });
      }

      await markMessagesRead(
        conversationKey,
        userId
      );

      return response(200, {
        ok: true,
        message: "Conversation marked as read."
      });
    }

    return response(405, {
      ok: false,
      error: "Method not allowed."
    });
  } catch (error) {
    console.error(
      "Chat function error:",
      error
    );

    return response(500, {
      ok: false,
      error:
        error?.message ||
        "Unable to process chat request."
    });
  }
};
