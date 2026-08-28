import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  Netlify.env.get("SUPABASE_URL") ||
  Netlify.env.get("VITE_SUPABASE_URL");

const SUPABASE_KEY =
  Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  Netlify.env.get("SUPABASE_ANON_KEY") ||
  Netlify.env.get("VITE_SUPABASE_ANON_KEY");

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

/* -----------------------------
   Helpers
----------------------------- */

function clean(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization",
      "Access-Control-Allow-Methods":
        "GET, POST, PUT, OPTIONS"
    },
    body: JSON.stringify(body)
  };
}

function parseBody(event) {
  if (!event.body) {
    return {};
  }

  try {
    return typeof event.body === "string"
      ? JSON.parse(event.body)
      : event.body;
  } catch {
    return {};
  }
}

/*
 * Always generate the same conversation key
 * regardless of which participant sends first.
 */
function makeConversationKey(userA, userB) {
  const a = clean(userA);
  const b = clean(userB);

  if (!a || !b || a === b) {
    return "";
  }

  return [a, b].sort().join(":");
}

function profileRole(profile) {
  if (!profile) {
    return "";
  }

  const role =
    profile.role ||
    profile.user_role ||
    profile.account_type ||
    profile.accountType ||
    "";

  const value = String(role).toLowerCase().trim();

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

function makeConversationType(roleA, roleB) {
  const roles = [
    String(roleA || "buyer").toLowerCase(),
    String(roleB || "buyer").toLowerCase()
  ].sort();

  if (
    roles.includes("admin") &&
    roles.includes("seller")
  ) {
    return "seller_admin";
  }

  if (
    roles.includes("admin") &&
    roles.includes("buyer")
  ) {
    return "buyer_admin";
  }

  if (
    roles.includes("seller") &&
    roles.includes("buyer")
  ) {
    return "buyer_seller";
  }

  if (
    roles[0] === "seller" &&
    roles[1] === "seller"
  ) {
    return "seller_seller";
  }

  if (
    roles[0] === "buyer" &&
    roles[1] === "buyer"
  ) {
    return "buyer_buyer";
  }

  return `${roles[0]}_${roles[1]}`;
}

/*
 * Try to identify the sender/receiver role from
 * the profiles table without breaking the chat if
 * the table has a different structure.
 */
async function getProfile(userId) {
  if (!userId) {
    return null;
  }

  const possibleTables = [
    "profiles",
    "users",
    "user_profiles"
  ];

  for (const table of possibleTables) {
    try {
      const result = await supabase
        .from(table)
        .select("*")
        .eq("id", userId)
        .maybeSingle();

      if (!result.error && result.data) {
        return result.data;
      }
    } catch {
      // Continue checking possible profile tables.
    }
  }

  return null;
}

/*
 * Insert using the current chat table first.
 * If optional columns cause an error, retry with
 * a minimal compatible message object.
 */
async function insertMessage(messageData) {
  const tables = [
    "chat_messages",
    "messages"
  ];

  let lastError = null;

  for (const table of tables) {
    try {
      const result = await supabase
        .from(table)
        .insert(messageData)
        .select("*")
        .single();

      if (!result.error) {
        return {
          data: result.data,
          table
        };
      }

      lastError = result.error;

      /*
       * Retry with only the fields most chat tables use.
       */
      const minimal = {
        sender_id: messageData.sender_id,
        receiver_id: messageData.receiver_id,
        message: messageData.message,
        created_at: messageData.created_at
      };

      const retry = await supabase
        .from(table)
        .insert(minimal)
        .select("*")
        .single();

      if (!retry.error) {
        return {
          data: retry.data,
          table
        };
      }

      lastError = retry.error;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error(
    "Unable to save chat message."
  );
}

/*
 * Fetch one private conversation.
 */
async function fetchMessages(
  conversationKey,
  limit = 100
) {
  const tables = [
    "chat_messages",
    "messages"
  ];

  let lastError = null;

  for (const table of tables) {
    try {
      /*
       * Preferred schema:
       * conversation_key
       */
      const result = await supabase
        .from(table)
        .select("*")
        .eq(
          "conversation_key",
          conversationKey
        )
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

      /*
       * Compatibility fallback for tables that
       * do not have conversation_key.
       */
      const participants =
        conversationKey.split(":");

      if (participants.length !== 2) {
        continue;
      }

      const [userA, userB] = participants;

      const fallback = await supabase
        .from(table)
        .select("*")
        .or(
          `and(sender_id.eq.${userA},receiver_id.eq.${userB}),and(sender_id.eq.${userB},receiver_id.eq.${userA})`
        )
        .order("created_at", {
          ascending: true
        })
        .limit(limit);

      if (!fallback.error) {
        return {
          data: fallback.data || [],
          table
        };
      }

      lastError = fallback.error;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error(
    "Unable to load conversation."
  );
}

/*
 * Mark incoming messages as read.
 */
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
       * Try both common read column names.
       */
      const first = await supabase
        .from(table)
        .update({
          read: true
        })
        .eq(
          "conversation_key",
          conversationKey
        )
        .eq(
          "receiver_id",
          userId
        );

      if (!first.error) {
        return;
      }

      const second = await supabase
        .from(table)
        .update({
          is_read: true
        })
        .eq(
          "conversation_key",
          conversationKey
        )
        .eq(
          "receiver_id",
          userId
        );

      if (!second.error) {
        return;
      }
    } catch {
      // Continue.
    }
  }
}

/*
 * Get all conversations for a user.
 */
async function listConversations(userId) {
  const tables = [
    "chat_messages",
    "messages"
  ];

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

      if (result.error) {
        continue;
      }

      const rows = result.data || [];

      /*
       * Group messages by conversation.
       */
      const map = new Map();

      for (const row of rows) {
        let key =
          clean(row.conversation_key);

        if (!key) {
          key = makeConversationKey(
            row.sender_id,
            row.receiver_id
          );
        }

        if (!key) {
          continue;
        }

        if (!map.has(key)) {
          map.set(key, row);
        }
      }

      return Array.from(map.entries()).map(
        ([conversationKey, lastMessage]) => {
          const participants =
            conversationKey.split(":");

          const otherUserId =
            participants.find(
              id => id !== userId
            ) || "";

          return {
            conversation_key:
              conversationKey,

            conversation_type:
              lastMessage.conversation_type ||
              "private",

            other_user_id:
              otherUserId,

            last_message:
              lastMessage.message ||
              lastMessage.content ||
              "",

            last_message_at:
              lastMessage.created_at ||
              null,

            sender_id:
              lastMessage.sender_id ||
              null,

            receiver_id:
              lastMessage.receiver_id ||
              null
          };
        }
      );
    } catch {
      // Try next table.
    }
  }

  return [];
}

/*
 * Extract user ID.
 *
 * The frontend can provide user_id in the body,
 * query, or authorization metadata.
 */
function getUserId(event, body) {
  const params =
    event.queryStringParameters || {};

  return (
    clean(body.user_id) ||
    clean(body.userId) ||
    clean(params.user_id) ||
    clean(params.userId)
  );
}

/* -----------------------------
   Main function
----------------------------- */

export default async function handler(event) {
  const method =
    String(event.httpMethod || "GET")
      .toUpperCase();

  /*
   * Browser preflight.
   */
  if (method === "OPTIONS") {
    return response(204, {});
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return response(500, {
        ok: false,
        error:
          "Supabase environment variables are not configured."
      });
    }

    const body = parseBody(event);

    /* =========================
       POST
       Send private message
       ========================= */

    if (method === "POST") {
      const senderId =
        getUserId(event, body);

      const receiverId =
        clean(body.receiver_id) ||
        clean(body.receiverId) ||
        clean(body.recipient_id) ||
        clean(body.recipientId);

      const message =
        clean(body.message) ||
        clean(body.content) ||
        clean(body.text);

      if (!senderId) {
        return response(401, {
          ok: false,
          error:
            "You must be logged in to send a message."
        });
      }

      if (!receiverId) {
        return response(400, {
          ok: false,
          error:
            "A receiver is required."
        });
      }

      if (senderId === receiverId) {
        return response(400, {
          ok: false,
          error:
            "You cannot message yourself."
        });
      }

      if (!message) {
        return response(400, {
          ok: false,
          error:
            "Message cannot be empty."
        });
      }

      if (message.length > 5000) {
        return response(400, {
          ok: false,
          error:
            "Message is too long."
        });
      }

      /*
       * Determine both users' roles.
       *
       * This allows:
       * buyer ↔ seller
       * buyer ↔ admin
       * seller ↔ admin
       * seller ↔ seller
       * buyer ↔ buyer
       */
      const senderProfile =
        await getProfile(senderId);

      const receiverProfile =
        await getProfile(receiverId);

      const senderRole =
        clean(body.sender_role) ||
        clean(body.senderRole) ||
        profileRole(senderProfile) ||
        "buyer";

      const receiverRole =
        clean(body.receiver_role) ||
        clean(body.receiverRole) ||
        profileRole(receiverProfile) ||
        "buyer";

      const conversationKey =
        makeConversationKey(
          senderId,
          receiverId
        );

      if (!conversationKey) {
        return response(400, {
          ok: false,
          error:
            "Invalid conversation."
        });
      }

      const conversationType =
        makeConversationType(
          senderRole,
          receiverRole
        );

      const now =
        new Date().toISOString();

      const newMessage = {
        sender_id: senderId,
        receiver_id: receiverId,

        /*
         * This key makes the conversation private
         * to exactly these two users.
         */
        conversation_key:
          conversationKey,

        conversation_type:
          conversationType,

        message: message,
        content: message,

        sender_role:
          senderRole,

        receiver_role:
          receiverRole,

        read: false,
        is_read: false,

        created_at: now
      };

      const saved =
        await insertMessage(
          newMessage
        );

      return response(200, {
        ok: true,

        message:
          saved.data,

        conversation_key:
          conversationKey,

        conversation_type:
          conversationType
      });
    }

    /* =========================
       GET
       Load conversations/messages
       ========================= */

    if (method === "GET") {
      const params =
        event.queryStringParameters || {};

      const userId =
        clean(params.user_id) ||
        clean(params.userId);

      if (!userId) {
        return response(401, {
          ok: false,
          error:
            "You must be logged in."
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
       * No conversation supplied:
       * return the user's private conversations.
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
          error:
            "Invalid conversation."
        });
      }

      /*
       * SECURITY:
       * A user can only open a conversation
       * where their own ID is one of the two
       * participants.
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

      const limit = Math.min(
        Math.max(
          Number(params.limit) || 100,
          1
        ),
        200
      );

      const result =
        await fetchMessages(
          finalConversationKey,
          limit
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

    /* =========================
       PUT
       Mark messages read
       ========================= */

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
        message:
          "Conversation marked as read."
      });
    }

    return response(405, {
      ok: false,
      error:
        "Method not allowed."
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
}
