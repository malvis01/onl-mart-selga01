import { createClient } from "@supabase/supabase-js";

/* =========================================================
   ENVIRONMENT
========================================================= */

// Support the variable names already used by the rest of the
// SALGA application. The new Netlify deployment may expose the
// Supabase URL as either SUPABASE_URL or VITE_SUPABASE_URL.
const env = (name) => {
  try {
    if (typeof Netlify !== "undefined" && Netlify.env?.get) {
      return Netlify.env.get(name);
    }
  } catch (_) {}
  return typeof process !== "undefined" ? process.env?.[name] : undefined;
};

const SUPABASE_URL =
  env("SUPABASE_URL") ||
  env("VITE_SUPABASE_URL");

// Service-role is preferred for server-side work, but the login
// itself only needs a publishable/anon key. This prevents admin login
// from failing solely because the new Netlify site has not yet copied
// the server-only key.
const SUPABASE_KEY =
  env("SUPABASE_SERVICE_ROLE_KEY") ||
  env("SUPABASE_PUBLISHABLE_KEY") ||
  env("VITE_SUPABASE_PUBLISHABLE_KEY") ||
  env("SUPABASE_ANON_KEY");

const ADMIN_EMAIL =
  (env("ADMIN_EMAIL") || "malvisdabz@gmail.com")
    .trim()
    .toLowerCase();

/* =========================================================
   HEADERS
========================================================= */

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

/* =========================================================
   JSON RESPONSE
========================================================= */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json"
    }
  });
}

/* =========================================================
   ADMIN FUNCTION
========================================================= */

export default async function handler(req) {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  if (req.method !== "POST") {
    return json({
      success: false,
      error: "Method not allowed."
    }, 405);
  }

  if (!SUPABASE_URL) {
    return json({
      success: false,
      error: "Supabase URL is not configured in Netlify. Set SUPABASE_URL or VITE_SUPABASE_URL."
    }, 500);
  }

  if (!SUPABASE_KEY) {
    return json({
      success: false,
      error: "Supabase API key is not configured in Netlify. Set SUPABASE_SERVICE_ROLE_KEY or a publishable/anon key."
    }, 500);
  }

  try {
    let body;
    try {
      body = await req.json();
    } catch (_) {
      return json({
        success: false,
        error: "Invalid JSON request."
      }, 400);
    }

    const email = String(body?.email || "").trim().toLowerCase();
    const password = String(body?.password || "");

    if (!email || !password) {
      return json({
        success: false,
        error: "Admin email and password are required."
      }, 400);
    }

    if (email !== ADMIN_EMAIL) {
      return json({
        success: false,
        error: "Invalid admin email or password."
      }, 401);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      console.error("SUPABASE ADMIN LOGIN ERROR:", error);
      return json({
        success: false,
        error: "Invalid admin email or password."
      }, 401);
    }

    if (!data?.user || !data?.session?.access_token) {
      return json({
        success: false,
        error: "Admin authentication did not return a secure session."
      }, 401);
    }

    const authenticatedEmail = String(data.user.email || "")
      .trim()
      .toLowerCase();

    if (authenticatedEmail !== ADMIN_EMAIL) {
      return json({
        success: false,
        error: "This account is not authorized as an administrator."
      }, 403);
    }

    const accessToken = data.session.access_token;
    const refreshToken = data.session.refresh_token || null;

    return json({
      success: true,
      message: "Admin login successful.",
      token: accessToken,
      access_token: accessToken,
      refresh_token: refreshToken,
      user: {
        id: data.user.id,
        email: data.user.email,
        role: "admin"
      },
      session: {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: data.session.expires_at,
        expires_in: data.session.expires_in,
        token_type: data.session.token_type || "bearer"
      }
    }, 200);
  } catch (error) {
    console.error("ADMIN FUNCTION ERROR:", error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : "Admin authentication failed."
    }, 500);
  }
}

/* =========================================================
   NETLIFY ROUTE
========================================================= */

export const config = {
  path: "/api/admin"
};
