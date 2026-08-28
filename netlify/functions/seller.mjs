import { createClient } from "@supabase/supabase-js";

const env = (name) => {
  try {
    if (
      typeof Netlify !== "undefined" &&
      Netlify.env?.get
    ) {
      return Netlify.env.get(name);
    }
  } catch (_) {}

  return typeof process !== "undefined"
    ? process.env?.[name]
    : undefined;
};

const SUPABASE_URL =
  env("SUPABASE_URL") ||
  env("VITE_SUPABASE_URL");

const SUPABASE_SERVICE_ROLE_KEY =
  env("SUPABASE_SERVICE_ROLE_KEY");

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization",
  "Access-Control-Allow-Methods":
    "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400"
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

function getSupabase() {
  if (
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY
  ) {
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
        persistSession: false
      }
    }
  );
}

async function getUser(req, supabase) {
  const authorization =
    req.headers.get("authorization") || "";

  if (
    !authorization
      .toLowerCase()
      .startsWith("bearer ")
  ) {
    return null;
  }

  const token =
    authorization
      .slice(7)
      .trim();

  if (!token) {
    return null;
  }

  const {
    data,
    error
  } = await supabase.auth.getUser(token);

  if (
    error ||
    !data?.user
  ) {
    return null;
  }

  return data.user;
}

function num(value) {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : 0;
}

export default async function handler(req) {

  if (req.method === "OPTIONS") {
    return new Response(
      "ok",
      { headers }
    );
  }

  if (
    !["GET", "POST"]
      .includes(req.method)
  ) {
    return json(
      {
        error:
          "Method not allowed"
      },
      405
    );
  }

  try {

    const supabase =
      getSupabase();

    /*
     * AUTHENTICATE SELLER
     */

    const user =
      await getUser(
        req,
        supabase
      );

    if (!user) {
      return json(
        {
          error:
            "Please log in as a business owner."
        },
        401
      );
    }

    /*
     * LOAD USER PROFILE
     */

    const {
      data: profile,
      error: profileError
    } =
      await supabase
        .from("profiles")
        .select(
          "id, phone, role, full_name"
        )
        .eq(
          "id",
          user.id
        )
        .maybeSingle();

    if (profileError) {
      throw profileError;
    }

    if (!profile) {
      return json(
        {
          error:
            "User profile not found."
        },
        404
      );
    }

    /*
     * ONLY SELLERS
     */

    if (
      profile.role !== "seller"
    ) {
      return json(
        {
          error:
            "Only business owners can access this dashboard."
        },
        403
      );
    }

    /*
     * FIND EXISTING BUSINESS
     */

    let {
      data: businesses,
      error: businessError
    } =
      await supabase
        .from("businesses")
        .select("*")
        .eq(
          "owner_id",
          user.id
        )
        .order(
          "id",
          {
            ascending: true
          }
        );

    if (businessError) {
      throw businessError;
    }

    /*
     * IMPORTANT:
     *
     * If the seller already has an account
     * but does not have a business row,
     * create the missing business profile.
     *
     * This DOES NOT modify products.
     */

    if (
      !businesses ||
      !businesses.length
    ) {

      const businessName =
        String(
          profile.full_name ||
          user.user_metadata?.businessName ||
          user.user_metadata?.full_name ||
          "My Business"
        ).trim();

      const {
        data: createdBusiness,
        error: createError
      } =
        await supabase
          .from("businesses")
          .insert({
            owner_id:
              user.id,

            business_name:
              businessName ||
              "My Business",

            status:
              "active"
          })
          .select("*")
          .single();

      if (createError) {
        throw createError;
      }

      businesses = [
        createdBusiness
      ];
    }

    /*
     * BUSINESS IDs
     */

    const businessIds =
      businesses.map(
        business =>
          business.id
      );

    /*
     * LOAD SELLER DATA
     */

    const [
      productsResult,
      ordersResult,
      transactionsResult,
      promotionsResult,
      conversationsResult
    ] =
      await Promise.all([

        supabase
          .from("products")
          .select("*")
          .in(
            "business_id",
            businessIds
          )
          .order(
            "created_at",
            {
              ascending: false
            }
          ),

        supabase
          .from("orders")
          .select("*")
          .in(
            "business_id",
            businessIds
          )
          .order(
            "created_at",
            {
              ascending: false
            }
          ),

        supabase
          .from("transactions")
          .select("*")
          .eq(
            "seller_id",
            user.id
          )
          .order(
            "completed_at",
            {
              ascending: false
            }
          ),

        supabase
          .from("promotions")
          .select("*")
          .eq(
            "seller_id",
            user.id
          )
          .order(
            "created_at",
            {
              ascending: false
            }
          ),

        /*
         * Seller's conversations.
         *
         * This will also support the chat
         * system we are adding next.
         */

        supabase
          .from("chat_conversations")
          .select("*")
          .eq(
            "seller_id",
            user.id
          )
          .order(
            "updated_at",
            {
              ascending: false
            }
          )

      ]);

    /*
     * CHECK DATABASE RESULTS
     */

    const results = [
      productsResult,
      ordersResult,
      transactionsResult,
      promotionsResult,
      conversationsResult
    ];

    for (
      const result of results
    ) {
      if (result.error) {
        throw result.error;
      }
    }

    /*
     * DATA
     */

    const products =
      productsResult.data || [];

    const orders =
      ordersResult.data || [];

    const transactions =
      transactionsResult.data || [];

    const promotions =
      promotionsResult.data || [];

    const conversations =
      conversationsResult.data || [];

    /*
     * FINANCIAL CALCULATIONS
     */

    const completed =
      transactions.filter(
        transaction =>
          String(
            transaction.status || ""
          ).toLowerCase() ===
          "completed"
      );

    const totalSales =
      completed.reduce(
        (sum, transaction) =>
          sum +
          num(
            transaction.gross_amount ??
            transaction.amount
          ),
        0
      );

    const marketplaceCommission =
      completed.reduce(
        (sum, transaction) =>
          sum +
          num(
            transaction.commission_amount ??
            transaction.marketplace_commission
          ),
        0
      );

    const promotionCommission =
      completed.reduce(
        (sum, transaction) =>
          sum +
          num(
            transaction.promotion_commission_amount ??
            transaction.promotion_commission
          ),
        0
      );

    const sellerBalance =
      completed.reduce(
        (sum, transaction) =>
          sum +
          num(
            transaction.seller_amount ??
            transaction.net_amount
          ),
        0
      );

    /*
     * RETURN COMPLETE SELLER DASHBOARD
     */

    return json({

      success:
        true,

      role:
        "seller",

      profile,

      /*
       * Main business profile.
       */

      business:
        businesses[0] ||
        null,

      businesses,

      products,

      orders,

      transactions,

      promotions,

      conversations,

      summary: {

        available_balance:
          sellerBalance,

        pending_balance:
          0,

        total_sales:
          totalSales,

        marketplace_commission:
          marketplaceCommission,

        promotion_commission:
          promotionCommission,

        promotion_spending:
          promotions.reduce(
            (sum, promotion) =>
              sum +
              num(
                promotion.amount ??
                promotion.price
              ),
            0
          ),

        total_orders:
          orders.length,

        total_products:
          products.length

      },

      commissionRates: {

        marketplace:
          0.05,

        promotion:
          0.03

      }

    });

  } catch (error) {

    console.error(
      "SELLER FUNCTION ERROR:",
      error
    );

    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load seller dashboard."
      },
      500
    );
  }
}

export const config = {
  path: "/api/seller"
};
