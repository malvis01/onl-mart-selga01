import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const ADMIN_EMAIL =
  process.env.ADMIN_EMAIL || "malvisdabz@gmail.com";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization",
  "Access-Control-Allow-Methods":
    "POST, OPTIONS"
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

export default async function handler(req) {

  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers
    });
  }

  if (req.method !== "POST") {
    return json(
      {
        error: "Method not allowed"
      },
      405
    );
  }

  if (!SUPABASE_URL) {
    return json(
      {
        error: "SUPABASE_URL is missing."
      },
      500
    );
  }

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return json(
      {
        error:
          "SUPABASE_SERVICE_ROLE_KEY is missing."
      },
      500
    );
  }

  try {

    const body = await req.json();

    const email =
      String(body.email || "")
        .trim()
        .toLowerCase();

    const password =
      String(body.password || "");

    if (!email || !password) {
      return json(
        {
          error:
            "Admin email and password are required."
        },
        400
      );
    }

    if (email !== ADMIN_EMAIL.toLowerCase()) {
      return json(
        {
          error: "Admin access denied."
        },
        403
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

    if (!data?.session) {
      return json(
        {
          error:
            "Admin login did not return a session."
        },
        500
      );
    }

    const user = data.user;

    /*
     * Verify the authenticated user.
     */
    const {
      data: profile,
      error: profileError
    } =
      await supabase
        .from("profiles")
        .select("id, email, role, full_name")
        .eq("id", user.id)
        .maybeSingle();

    if (profileError) {
      console.error(
        "ADMIN PROFILE ERROR:",
        profileError
      );

      return json(
        {
          error:
            profileError.message
        },
        500
      );
    }

    /*
     * Admin can be identified by the configured
     * admin email even if an old profile does not
     * yet have role=admin.
     */
    if (
      profile &&
      profile.role &&
      profile.role !== "admin"
    ) {
      return json(
        {
          error:
            "This account is not an admin account."
        },
        403
      );
    }

    /*
     * Return dashboard information.
     */

    const [
      buyersResult,
      sellersResult,
      businessesResult,
      productsResult,
      ordersResult
    ] = await Promise.all([

      supabase
        .from("profiles")
        .select("id", {
          count: "exact",
          head: true
        })
        .eq("role", "buyer"),

      supabase
        .from("profiles")
        .select("id", {
          count: "exact",
          head: true
        })
        .eq("role", "seller"),

      supabase
        .from("businesses")
        .select("id", {
          count: "exact",
          head: true
        }),

      supabase
        .from("products")
        .select("id", {
          count: "exact",
          head: true
        }),

      supabase
        .from("orders")
        .select(
          "id,total_amount,marketplace_commission,payment_status,status,created_at"
        )
        .order(
          "created_at",
          {
            ascending: false
          }
        )
        .limit(100)
    ]);

    if (buyersResult.error) {
      console.error(
        "BUYERS ERROR:",
        buyersResult.error
      );
    }

    if (sellersResult.error) {
      console.error(
        "SELLERS ERROR:",
        sellersResult.error
      );
    }

    if (businessesResult.error) {
      console.error(
        "BUSINESSES ERROR:",
        businessesResult.error
      );
    }

    if (productsResult.error) {
      console.error(
        "PRODUCTS ERROR:",
        productsResult.error
      );
    }

    if (ordersResult.error) {
      console.error(
        "ORDERS ERROR:",
        ordersResult.error
      );
    }

    const orders =
      ordersResult.data || [];

    const totalCommission =
      orders.reduce(
        (sum, order) =>
          sum +
          Number(
            order.marketplace_commission || 0
          ),
        0
      );

    return json({
      success: true,

      message:
        "Admin login successful.",

      user: {
        id: user.id,
        email: user.email,
        role: "admin",
        full_name:
          profile?.full_name ||
          "Administrator"
      },

      session:
        data.session,

      dashboard: {
        buyers:
          buyersResult.count || 0,

        sellers:
          sellersResult.count || 0,

        businesses:
          businessesResult.count || 0,

        products:
          productsResult.count || 0,

        orders:
          orders.length,

        marketplaceCommission:
          totalCommission
      },

      orders
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
            : "Invalid server response."
      },
      500
    );
  }
}

export const config = {
  path: "/api/admin"
};
