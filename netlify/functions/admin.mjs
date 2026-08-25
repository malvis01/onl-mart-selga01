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
    "POST, OPTIONS"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json"
    }
  });
}

export default async function handler(req) {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  if (req.method !== "POST") {
    return json(
      { error: "Method not allowed" },
      405
    );
  }

  if (!SUPABASE_URL) {
    return json(
      { error: "SUPABASE_URL is not configured." },
      500
    );
  }

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return json(
      {
        error:
          "SUPABASE_SERVICE_ROLE_KEY is not configured."
      },
      500
    );
  }

  try {
    const body = await req.json();

    const email = String(body.email || "")
      .trim()
      .toLowerCase();

    const password = String(body.password || "");

    if (!email || !password) {
      return json(
        {
          error:
            "Admin email and password are required."
        },
        400
      );
    }

    if (email !== ADMIN_EMAIL) {
      return json(
        {
          error: "Invalid admin email or password."
        },
        401
      );
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

    /*
     * Sign in using the real Supabase Auth account.
     */
    const {
      data,
      error
    } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      console.error(
        "ADMIN LOGIN ERROR:",
        error
      );

      return json(
        {
          error:
            "Invalid admin email or password."
        },
        401
      );
    }

    if (!data.user || !data.session) {
      return json(
        {
          error:
            "Admin authentication did not return a valid session."
        },
        401
      );
    }

    /*
     * Confirm the authenticated account is
     * the configured admin account.
     */
    if (
      data.user.email?.toLowerCase() !==
      ADMIN_EMAIL
    ) {
      return json(
        {
          error: "Unauthorized admin account."
        },
        403
      );
    }

    return json({
      success: true,
      message: "Admin login successful.",

      user: {
        id: data.user.id,
        email: data.user.email,
        role: "admin"
      },

      session: data.session
    });
  } catch (error) {
    console.error(
      "ADMIN FUNCTION ERROR:",
      error
    );

    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Admin authentication failed."
      },
      500
    );
  }
}

export const config = {
  path: "/api/admin"
};
