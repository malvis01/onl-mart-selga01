import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const ADMIN_EMAIL =
  "malvisdabz@gmail.com";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization",
  "Access-Control-Allow-Methods":
    "GET, POST, PATCH, OPTIONS"
};

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        ...headers,
        "Content-Type":
          "application/json"
      }
    }
  );
}

function supabase() {
  return createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );
}

async function getUser(req) {

  const authorization =
    req.headers.get(
      "Authorization"
    ) || "";

  if (
    !authorization.startsWith(
      "Bearer "
    )
  ) {
    return null;
  }

  const token =
    authorization.substring(7);

  const {
    data,
    error
  } =
    await supabase()
      .auth
      .getUser(token);

  if (
    error ||
    !data ||
    !data.user
  ) {
    return null;
  }

  return data.user;
}

function getRole(user) {

  if (
    (user.email || "")
      .toLowerCase() ===
    ADMIN_EMAIL.toLowerCase()
  ) {
    return "admin";
  }

  return (
    user.user_metadata?.role ||
    "buyer"
  );
}

function canAccess(
  conversation,
  user,
  role
) {

  if (role === "admin") {
    return true;
  }

  return (
    conversation.buyer_id ===
      user.id ||
    conversation.seller_id ===
      user.id
  );
}

export default async function handler(
  req
) {

  if (
    req.method ===
    "OPTIONS"
  ) {
    return new Response(
      "ok",
      { headers }
    );
  }

  if (
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY
  ) {
    return json(
      {
        error:
          "Supabase server configuration is missing."
      },
      500
    );
  }

  const user =
    await getUser(req);

  if (!user) {
    return json(
      {
        error:
          "Please log in before using chat."
      },
      401
    );
  }

  const role =
    getRole(user);

  const db =
    supabase();

  try {

    /*
     * ==========================================
     * GET CONVERSATIONS OR MESSAGES
     * ==========================================
     */

    if (
      req.method === "GET"
    ) {

      const url =
        new URL(req.url);

      const conversationId =
        url.searchParams.get(
          "conversation_id"
        );

      /*
       * Get one conversation
       */

      if (conversationId) {

        const {
          data:
            conversation,
          error:
            conversationError
        } =
          await db
            .from(
              "chat_conversations"
            )
            .select("*")
            .eq(
              "id",
              conversationId
            )
            .single();

        if (
          conversationError ||
          !conversation
        ) {
          return json(
            {
              error:
                "Conversation not found."
            },
            404
          );
        }

        if (
          !canAccess(
            conversation,
            user,
            role
          )
        ) {
          return json(
            {
              error:
                "You are not allowed to access this conversation."
            },
            403
          );
        }

        const {
          data:
            messages,
          error:
            messageError
        } =
          await db
            .from(
              "chat_messages"
            )
            .select("*")
            .eq(
              "conversation_id",
              conversationId
            )
            .order(
              "created_at",
              {
                ascending: true
              }
            );

        if (messageError) {
          return json(
            {
              error:
                messageError.message
            },
            500
          );
        }

        /*
         * Mark messages from other people
         * as read.
         */

        await db
          .from(
            "chat_messages"
          )
          .update({
            read_at:
              new Date()
                .toISOString()
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
          conversation,
          messages:
            messages || []
        });
      }

      /*
       * Get conversation list
       */

      let query =
        db
          .from(
            "chat_conversations"
          )
          .select("*")
          .order(
            "updated_at",
            {
              ascending: false
            }
          );

      if (
        role === "buyer"
      ) {

        query =
          query.eq(
            "buyer_id",
            user.id
          );

      } else if (
        role === "seller"
      ) {

        query =
          query.eq(
            "seller_id",
            user.id
          );

      } else {

        query =
          query.eq(
            "admin_involved",
            true
          );
      }

      const {
        data:
          conversations,
        error
      } =
        await query;

      if (error) {
        return json(
          {
            error:
              error.message
          },
          500
        );
      }

      return json({
        conversations:
          conversations || []
      });
    }

    /*
     * ==========================================
     * CREATE CONVERSATION
     * ==========================================
     */

    if (
      req.method === "POST"
    ) {

      const body =
        await req.json();

      const targetId =
        String(
          body.target_id || ""
        ).trim();

      const targetRole =
        String(
          body.target_role || ""
        ).trim();

      const firstMessage =
        String(
          body.message || ""
        ).trim();

      if (
        !targetId ||
        ![
          "buyer",
          "seller",
          "admin"
        ].includes(
          targetRole
        )
      ) {
        return json(
          {
            error:
              "A valid chat recipient is required."
          },
          400
        );
      }

      if (
        targetRole === role
      ) {
        return json(
          {
            error:
              "You cannot chat with yourself."
          },
          400
        );
      }

      let query =
        db
          .from(
            "chat_conversations"
          )
          .select("*");

      /*
       * Buyer <-> Seller
       */

      if (
        role === "buyer" &&
        targetRole === "seller"
      ) {

        query =
          query
            .eq(
              "buyer_id",
              user.id
            )
            .eq(
              "seller_id",
              targetId
            )
            .eq(
              "admin_involved",
              false
            );

      } else if (
        role === "seller" &&
        targetRole === "buyer"
      ) {

        query =
          query
            .eq(
              "buyer_id",
              targetId
            )
            .eq(
              "seller_id",
              user.id
            )
            .eq(
              "admin_involved",
              false
            );

      /*
       * Buyer/Seller <-> Admin
       */

      } else if (
        targetRole === "admin"
      ) {

        query =
          query.eq(
            "admin_involved",
            true
          );

        if (
          role === "buyer"
        ) {
          query =
            query.eq(
              "buyer_id",
              user.id
            );
        }

        if (
          role === "seller"
        ) {
          query =
            query.eq(
              "seller_id",
              user.id
            );
        }

      } else if (
        role === "admin"
      ) {

        query =
          query.eq(
            "admin_involved",
            true
          );

        if (
          targetRole === "buyer"
        ) {
          query =
            query.eq(
              "buyer_id",
              targetId
            );
        }

        if (
          targetRole === "seller"
        ) {
          query =
            query.eq(
              "seller_id",
              targetId
            );
        }

      } else {

        return json(
          {
            error:
              "Invalid chat participants."
          },
          400
        );
      }

      const {
        data:
          existing
      } =
        await query
          .maybeSingle();

      let conversation =
        existing;

      /*
       * Create conversation
       * if it doesn't exist.
       */

      if (!conversation) {

        const newConversation = {

          buyer_id:
            role === "buyer"
              ? user.id
              : targetRole === "buyer"
                ? targetId
                : null,

          seller_id:
            role === "seller"
              ? user.id
              : targetRole === "seller"
                ? targetId
                : null,

          admin_involved:
            role === "admin" ||
            targetRole === "admin"
        };

        const {
          data,
          error
        } =
          await db
            .from(
              "chat_conversations"
            )
            .insert(
              newConversation
            )
            .select()
            .single();

        if (error) {
          return json(
            {
              error:
                error.message
            },
            500
          );
        }

        conversation =
          data;
      }

      /*
       * Optional first message.
       */

      if (firstMessage) {

        const {
          error
        } =
          await db
            .from(
              "chat_messages"
            )
            .insert({
              conversation_id:
                conversation.id,

              sender_id:
                user.id,

              sender_role:
                role,

              message:
                firstMessage
            });

        if (error) {
          return json(
            {
              error:
                error.message
            },
            500
          );
        }

        await db
          .from(
            "chat_conversations"
          )
          .update({
            updated_at:
              new Date()
                .toISOString()
          })
          .eq(
            "id",
            conversation.id
          );
      }

      return json({
        success: true,
        conversation
      });
    }

    /*
     * ==========================================
     * SEND MESSAGE
     * ==========================================
     */

    if (
      req.method === "PATCH"
    ) {

      const body =
        await req.json();

      const conversationId =
        String(
          body.conversation_id ||
            ""
        ).trim();

      const message =
        String(
          body.message || ""
        ).trim();

      if (
        !conversationId ||
        !message
      ) {
        return json(
          {
            error:
              "Conversation and message are required."
          },
          400
        );
      }

      const {
        data:
          conversation,
        error:
          conversationError
      } =
        await db
          .from(
            "chat_conversations"
          )
          .select("*")
          .eq(
            "id",
            conversationId
          )
          .single();

      if (
        conversationError ||
        !conversation
      ) {
        return json(
          {
            error:
              "Conversation not found."
          },
          404
        );
      }

      if (
        !canAccess(
          conversation,
          user,
          role
        )
      ) {
        return json(
          {
            error:
              "You are not allowed to send messages here."
          },
          403
        );
      }

      const {
        data:
          savedMessage,
        error
      } =
        await db
          .from(
            "chat_messages"
          )
          .insert({
            conversation_id:
              conversationId,

            sender_id:
              user.id,

            sender_role:
              role,

            message
          })
          .select()
          .single();

      if (error) {
        return json(
          {
            error:
              error.message
          },
          500
        );
      }

      await db
        .from(
          "chat_conversations"
        )
        .update({
          updated_at:
            new Date()
              .toISOString()
        })
        .eq(
          "id",
          conversationId
        );

      return json({
        success: true,
        message:
          savedMessage
      });
    }

    return json(
      {
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
        error:
          error instanceof Error
            ? error.message
            : "Chat request failed."
      },
      500
    );
  }
}

export const config = {
  path: "/api/chat"
};
