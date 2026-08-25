import { createClient } from "@supabase/supabase-js";

/* =========================================================
   ENVIRONMENT
========================================================= */

const SUPABASE_URL =
  Netlify.env.get("SUPABASE_URL");

const SUPABASE_SERVICE_ROLE_KEY =
  Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");

const ADMIN_EMAIL =
  "malvisdabz@gmail.com";

/* =========================================================
   HEADERS
========================================================= */

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization",
  "Access-Control-Allow-Methods":
    "POST, OPTIONS"
};

/* =========================================================
   JSON RESPONSE
========================================================= */

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

/* =========================================================
   ADMIN FUNCTION
========================================================= */

export default async function handler(req) {

  /* -------------------------------------------------------
     CORS
  ------------------------------------------------------- */

  if (req.method === "OPTIONS") {
    return new Response(
      "ok",
      { headers }
    );
  }

  /* -------------------------------------------------------
     METHOD
  ------------------------------------------------------- */

  if (req.method !== "POST") {
    return json(
      {
        success: false,
        error: "Method not allowed."
      },
      405
    );
  }

  /* -------------------------------------------------------
     ENVIRONMENT CHECK
  ------------------------------------------------------- */

  if (!SUPABASE_URL) {
    return json(
      {
        success: false,
        error:
          "SUPABASE_URL is not configured in Netlify."
      },
      500
    );
  }

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return json(
      {
        success: false,
        error:
          "SUPABASE_SERVICE_ROLE_KEY is not configured in Netlify."
      },
      500
    );
  }

  try {

    /* -----------------------------------------------------
       READ REQUEST
    ----------------------------------------------------- */

    let body;

    try {

      body = await req.json();

    } catch (error) {

      return json(
        {
          success: false,
          error:
            "Invalid JSON request."
        },
        400
      );
    }

    const email =
      String(
        body?.email || ""
      )
      .trim()
      .toLowerCase();

    const password =
      String(
        body?.password || ""
      );

    /* -----------------------------------------------------
       VALIDATE
    ----------------------------------------------------- */

    if (!email || !password) {

      return json(
        {
          success: false,
          error:
            "Admin email and password are required."
        },
        400
      );
    }

    /* -----------------------------------------------------
       ONLY THE CONFIGURED ADMIN EMAIL
    ----------------------------------------------------- */

    if (
      email !==
      ADMIN_EMAIL.toLowerCase()
    ) {

      return json(
        {
          success: false,
          error:
            "Invalid admin email or password."
        },
        401
      );
    }

    /* -----------------------------------------------------
       SUPABASE ADMIN CLIENT
    ----------------------------------------------------- */

    const supabase =
      createClient(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY,
        {
          auth: {
            autoRefreshToken: false,
            persistSession: false
          }
        }
      );

    /* -----------------------------------------------------
       REAL SUPABASE LOGIN
    ----------------------------------------------------- */

    const {
      data,
      error
    } =
      await supabase.auth.signInWithPassword({
        email,
        password
      });

    if (error) {

      console.error(
        "SUPABASE ADMIN LOGIN ERROR:",
        error
      );

      return json(
        {
          success: false,
          error:
            "Invalid admin email or password."
        },
        401
      );
    }

    /* -----------------------------------------------------
       VERIFY SESSION
    ----------------------------------------------------- */

    if (
      !data ||
      !data.user ||
      !data.session ||
      !data.session.access_token
    ) {

      return json(
        {
          success: false,
          error:
            "Admin authentication did not return a secure session."
        },
        401
      );
    }

    /* -----------------------------------------------------
       VERIFY EMAIL AGAIN
    ----------------------------------------------------- */

    const authenticatedEmail =
      String(
        data.user.email || ""
      )
      .trim()
      .toLowerCase();

    if (
      authenticatedEmail !==
      ADMIN_EMAIL.toLowerCase()
    ) {

      return json(
        {
          success: false,
          error:
            "This account is not authorized as an administrator."
        },
        403
      );
    }

    /* -----------------------------------------------------
       REAL SECURE TOKEN
    ----------------------------------------------------- */

    const accessToken =
      data.session.access_token;

    const refreshToken =
      data.session.refresh_token || null;

    /* -----------------------------------------------------
       SUCCESS
    ----------------------------------------------------- */

    return json(
      {
        success: true,

        message:
          "Admin login successful.",

        token:
          accessToken,

        access_token:
          accessToken,

        refresh_token:
          refreshToken,

        user: {
          id:
            data.user.id,

          email:
            data.user.email,

          role:
            "admin"
        },

        session: {
          access_token:
            accessToken,

          refresh_token:
            refreshToken,

          expires_at:
            data.session.expires_at,

          expires_in:
            data.session.expires_in,

          token_type:
            data.session.token_type || "bearer"
        }
      },
      200
    );

  } catch (error) {

    console.error(
      "ADMIN FUNCTION ERROR:",
      error
    );

    return json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Admin authentication failed."
      },
      500
    );
  }
}

/* =========================================================
   NETLIFY ROUTE
========================================================= */

export const config = {
  path:
    "/api/admin"
};
