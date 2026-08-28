import { createClient } from "@supabase/supabase-js";

/*
  SALGA DIGITAL MART
  Netlify Chat Function

  File:
  netlify/functions/chat.js

  Endpoint:
  /api/chat
*/

const SUPABASE_URL =
  Netlify.env.get("SUPABASE_URL") ||
  Netlify.env.get("VITE_SUPABASE_URL");

const SUPABASE_SERVICE_ROLE_KEY =
  Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!SUPABASE_URL) {
  throw new Error("Missing SUPABASE_URL environment variable");
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    "Missing SUPABASE_SERVICE_ROLE_KEY environment variable"
  );
}

/*
  IMPORTANT:
  The service-role key is used ONLY inside this Netlify Function.
  Never put this key in your frontend HTML or public JavaScript.
*/

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


/* ==============================
   JSON RESPONSE HELPER
   ============================== */

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization",
        "Access-Control-Allow-Methods":
          "GET, POST, OPTIONS"
      }
    }
  );
}


/* ==============================
   MAIN FUNCTION
   ============================== */

export default async function handler(request) {

  /*
    Handle browser CORS preflight.
  */

  if (request.method === "OPTIONS") {
    return json({
      ok: true
    });
  }


  try {

    const url = new URL(request.url);


    /* ==========================================
       GET
       Retrieve messages for a conversation
       ========================================== */

    if (request.method === "GET") {

      const conversationId =
        url.searchParams.get("conversation_id");


      if (!conversationId) {
        return json(
          {
            ok: false,
            error: "conversation_id is required"
          },
          400
        );
      }


      const { data, error } = await supabase
        .from("messages")
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


      if (error) {
        console.error(
          "CHAT GET ERROR:",
          error
        );

        return json(
          {
            ok: false,
            error: error.message
          },
          500
        );
      }


      return json({
        ok: true,
        messages: data || []
      });
    }



    /* ==========================================
       POST
       Send a new message
       ========================================== */

    if (request.method === "POST") {

      let body;

      try {

        body = await request.json();

      } catch (error) {

        return json(
          {
            ok: false,
            error: "Invalid JSON request body"
          },
          400
        );
      }


      /*
        Accept both snake_case and camelCase
        so the frontend has some flexibility.
      */

      const conversationId =
        body?.conversation_id ||
        body?.conversationId;

      const senderId =
        body?.sender_id ||
        body?.senderId;

      const senderRole =
        body?.sender_role ||
        body?.senderRole ||
        "buyer";

      const message =
        typeof body?.message === "string"
          ? body.message.trim()
          : "";


      /* ==============================
         VALIDATION
         ============================== */

      if (!conversationId) {

        return json(
          {
            ok: false,
            error:
              "conversation_id is required"
          },
          400
        );
      }


      if (!senderId) {

        return json(
          {
            ok: false,
            error:
              "sender_id is required"
          },
          400
        );
      }


      if (!message) {

        return json(
          {
            ok: false,
            error:
              "message is required"
          },
          400
        );
      }


      if (message.length > 5000) {

        return json(
          {
            ok: false,
            error:
              "Message cannot exceed 5000 characters"
          },
          400
        );
      }


      /*
        Only allow the roles used by
        the SALGA marketplace.
      */

      const allowedRoles = [
        "buyer",
        "seller",
        "business",
        "admin"
      ];


      const finalRole =
        allowedRoles.includes(
          String(senderRole).toLowerCase()
        )
          ? String(senderRole).toLowerCase()
          : "buyer";


      /* ==============================
         INSERT MESSAGE
         ============================== */

      const { data, error } = await supabase
        .from("messages")
        .insert({
          conversation_id:
            conversationId,

          sender_id:
            senderId,

          sender_role:
            finalRole,

          message:
            message
        })
        .select("*")
        .single();


      if (error) {

        console.error(
          "CHAT POST ERROR:",
          error
        );

        return json(
          {
            ok: false,
            error: error.message
          },
          500
        );
      }


      return json(
        {
          ok: true,
          message: data
        },
        201
      );
    }



    /* ==========================================
       DELETE
       Delete a message if requested by
       your frontend/admin system.
       ========================================== */

    if (request.method === "DELETE") {

      const messageId =
        url.searchParams.get(
          "message_id"
        );


      if (!messageId) {

        return json(
          {
            ok: false,
            error:
              "message_id is required"
          },
          400
        );
      }


      const { data, error } =
        await supabase
          .from("messages")
          .delete()
          .eq(
            "id",
            messageId
          )
          .select("*");


      if (error) {

        console.error(
          "CHAT DELETE ERROR:",
          error
        );

        return json(
          {
            ok: false,
            error: error.message
          },
          500
        );
      }


      return json({
        ok: true,
        deleted: data || []
      });
    }



    /* ==========================================
       OTHER HTTP METHODS
       ========================================== */

    return json(
      {
        ok: false,
        error:
          "Method not allowed"
      },
      405
    );


  } catch (error) {

    console.error(
      "CHAT FUNCTION ERROR:",
      error
    );


    return json(
      {
        ok: false,
        error:
          error?.message ||
          "Chat service error"
      },
      500
    );
  }
}


/* ==========================================
   NETLIFY FUNCTION ROUTE
   ========================================== */

export const config = {
  path: "/api/chat"
};
