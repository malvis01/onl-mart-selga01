import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Netlify.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY =
  Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Supabase server environment variables are missing.");
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

const ADMIN_EMAIL = "malvisdabz@gmail.com";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization",
  "Access-Control-Allow-Methods":
    "GET, OPTIONS"
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

/* =========================================================
   AUTHENTICATE REAL SUPABASE USER
========================================================= */

async function getUser(req) {
  const authorization = req.headers.get("authorization");

  if (
    !authorization ||
    !authorization.toLowerCase().startsWith("bearer ")
  ) {
    return null;
  }

  const token = authorization.substring(7).trim();

  if (!token) return null;

  const {
    data,
    error
  } = await supabase.auth.getUser(token);

  if (error || !data?.user) {
    console.error("AUTH ERROR:", error);
    return null;
  }

  return data.user;
}

/* =========================================================
   SAFE NUMBER
========================================================= */

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/* =========================================================
   ADMIN DASHBOARD
========================================================= */

async function adminDashboard() {
  const [
    usersResult,
    businessesResult,
    productsResult,
    ordersResult,
    transactionsResult,
    promotionsResult,
    advertisementsResult,
    walletResult,
    withdrawalsResult
  ] = await Promise.all([

    supabase
      .from("profiles")
      .select(
        "id, phone, role, full_name",
        { count: "exact" }
      ),

    supabase
      .from("businesses")
      .select(
        "id, owner_id, business_name, status",
        { count: "exact" }
      ),

    supabase
      .from("products")
      .select(
        "id, business_id, name, price, stock, status, approved",
        { count: "exact" }
      ),

    supabase
      .from("orders")
      .select(
        "id, buyer_id, business_id, total_amount, delivery_fee, marketplace_commission, status, payment_status, created_at, updated_at",
        { count: "exact" }
      )
      .order("created_at", { ascending: false }),

    supabase
      .from("transactions")
      .select("*")
      .order("completed_at", { ascending: false }),

    supabase
      .from("promotions")
      .select("*")
      .order("created_at", { ascending: false }),

    supabase
      .from("advertisements")
      .select("*")
      .order("created_at", { ascending: false }),

    supabase
      .from("platform_wallet")
      .select("*")
      .limit(1)
      .maybeSingle(),

    supabase
      .from("admin_withdrawals")
      .select("*")
      .order("created_at", { ascending: false })
  ]);

  const results = [
    usersResult,
    businessesResult,
    productsResult,
    ordersResult,
    transactionsResult,
    promotionsResult,
    advertisementsResult,
    walletResult,
    withdrawalsResult
  ];

  for (const result of results) {
    if (result.error) {
      console.error("ADMIN QUERY ERROR:", result.error);
      throw result.error;
    }
  }

  const users = usersResult.data || [];
  const businesses = businessesResult.data || [];
  const products = productsResult.data || [];
  const orders = ordersResult.data || [];
  const transactions = transactionsResult.data || [];
  const promotions = promotionsResult.data || [];
  const advertisements = advertisementsResult.data || [];
  const withdrawals = withdrawalsResult.data || [];
  const wallet = walletResult.data || null;

  const completedTransactions =
    transactions.filter(
      t => String(t.status || "").toLowerCase() === "completed"
    );

  /*
   * REAL marketplace commission.
   *
   * Prefer the value already recorded by the payment system.
   * Do not manufacture commission figures.
   */
  const marketplaceCommission =
    completedTransactions.reduce(
      (total, transaction) =>
        total + num(transaction.commission_amount),
      0
    );

  /*
   * REAL promotion commission.
   */
  const promotionCommission =
    completedTransactions.reduce(
      (total, transaction) =>
        total + num(transaction.promotion_commission_amount),
      0
    );

  /*
   * Promotion/advertisement records can also contain
   * their actual charged commission.
   */
  const promotionRecordCommission =
    promotions.reduce(
      (total, promotion) =>
        total +
        num(
          promotion.commission_amount ??
          promotion.commission
        ),
      0
    );

  const advertisementCommission =
    advertisements.reduce(
      (total, advertisement) =>
        total +
        num(
          advertisement.commission_amount ??
          advertisement.commission
        ),
      0
    );

  const totalPlatformCommission =
    marketplaceCommission +
    promotionCommission;

  const totalGrossSales =
    completedTransactions.reduce(
      (total, transaction) =>
        total + num(transaction.gross_amount),
      0
    );

  const totalSellerAmount =
    completedTransactions.reduce(
      (total, transaction) =>
        total + num(transaction.seller_amount),
      0
    );

  const paidOrders =
    orders.filter(
      order =>
        String(order.payment_status || "").toLowerCase() === "paid"
    );

  return {
    role: "admin",

    commissionRates: {
      marketplace: 0.05,
      promotion: 0.03
    },

    statistics: {
      totalUsers: users.length,
      buyers: users.filter(u => u.role === "buyer").length,
      sellers: users.filter(u => u.role === "seller").length,

      totalBusinesses: businesses.length,
      totalProducts: products.length,
      totalOrders: orders.length,
      paidOrders: paidOrders.length,

      totalGrossSales,
      totalSellerAmount,

      marketplaceCommission,
      promotionCommission,

      promotionRecordCommission,
      advertisementCommission,

      totalPlatformCommission,

      availablePlatformBalance:
        num(wallet?.balance),

      withdrawnCommission:
        withdrawals
          .filter(
            w =>
              String(w.status || "").toLowerCase() === "completed"
          )
          .reduce(
            (total, w) =>
              total + num(w.amount),
            0
          )
    },

    users,
    businesses,
    products,
    orders,
    transactions,
    promotions,
    advertisements,
    withdrawals,

    wallet
  };
}

/* =========================================================
   BUYER DASHBOARD
========================================================= */

async function buyerDashboard(user, profile) {
  const [
    ordersResult,
    conversationsResult
  ] = await Promise.all([

    supabase
      .from("orders")
      .select(`
        id,
        business_id,
        total_amount,
        delivery_fee,
        marketplace_commission,
        status,
        payment_status,
        created_at,
        updated_at,
        businesses (
          id,
          business_name,
          logo_url
        ),
        order_items (
          id,
          product_id,
          quantity,
          unit_price,
          products (
            id,
            name,
            image_url
          )
        )
      `)
      .eq("buyer_id", user.id)
      .order("created_at", { ascending: false }),

    supabase
      .from("chat_conversations")
      .select("*")
      .eq("buyer_id", user.id)
      .order("updated_at", { ascending: false })
  ]);

  if (ordersResult.error) {
    throw ordersResult.error;
  }

  if (conversationsResult.error) {
    throw conversationsResult.error;
  }

  const orders = ordersResult.data || [];

  const paidOrders =
    orders.filter(
      order =>
        String(order.payment_status || "").toLowerCase() === "paid"
    );

  const completedOrders =
    orders.filter(
      order =>
        String(order.status || "").toLowerCase() === "completed"
    );

  const totalSpent =
    paidOrders.reduce(
      (total, order) =>
        total + num(order.total_amount),
      0
    );

  return {
    role: "buyer",

    profile,

    statistics: {
      totalOrders: orders.length,
      paidOrders: paidOrders.length,
      completedOrders: completedOrders.length,
      totalSpent
    },

    orders,

    conversations:
      conversationsResult.data || []
  };
}

/* =========================================================
   SELLER DASHBOARD
========================================================= */

async function sellerDashboard(user, profile) {
  const {
    data: businesses,
    error: businessesError
  } = await supabase
    .from("businesses")
    .select("*")
    .eq("owner_id", user.id);

  if (businessesError) {
    throw businessesError;
  }

  const businessIds =
    (businesses || []).map(b => b.id);

  if (!businessIds.length) {
    return {
      role: "seller",
      profile,
      businesses: [],
      products: [],
      orders: [],
      transactions: [],
      statistics: {
        totalSales: 0,
        commission: 0,
        sellerBalance: 0,
        totalOrders: 0,
        totalProducts: 0
      }
    };
  }

  const [
    productsResult,
    ordersResult,
    transactionsResult,
    promotionsResult
  ] = await Promise.all([

    supabase
      .from("products")
      .select("*")
      .in("business_id", businessIds)
      .order("created_at", { ascending: false }),

    supabase
      .from("orders")
      .select(`
        id,
        buyer_id,
        business_id,
        total_amount,
        delivery_fee,
        marketplace_commission,
        status,
        payment_status,
        created_at,
        updated_at,
        order_items (
          id,
          product_id,
          quantity,
          unit_price,
          products (
            id,
            name,
            image_url
          )
        )
      `)
      .in("business_id", businessIds)
      .order("created_at", { ascending: false }),

    supabase
      .from("transactions")
      .select("*")
      .eq("seller_id", user.id)
      .order("completed_at", { ascending: false }),

    supabase
      .from("promotions")
      .select("*")
      .eq("seller_id", user.id)
      .order("created_at", { ascending: false })
  ]);

  if (productsResult.error) {
    throw productsResult.error;
  }

  if (ordersResult.error) {
    throw ordersResult.error;
  }

  if (transactionsResult.error) {
    throw transactionsResult.error;
  }

  if (promotionsResult.error) {
    throw promotionsResult.error;
  }

  const products = productsResult.data || [];
  const orders = ordersResult.data || [];
  const transactions = transactionsResult.data || [];
  const promotions = promotionsResult.data || [];

  const completedTransactions =
    transactions.filter(
      t =>
        String(t.status || "").toLowerCase() === "completed"
    );

  const totalSales =
    completedTransactions.reduce(
      (total, transaction) =>
        total + num(transaction.gross_amount),
      0
    );

  const commission =
    completedTransactions.reduce(
      (total, transaction) =>
        total + num(transaction.commission_amount),
      0
    );

  const promotionCommission =
    completedTransactions.reduce(
      (total, transaction) =>
        total + num(transaction.promotion_commission_amount),
      0
    );

  const sellerBalance =
    completedTransactions.reduce(
      (total, transaction) =>
        total + num(transaction.seller_amount),
      0
    );

  return {
    role: "seller",

    profile,

    businesses,

    products,

    orders,

    transactions,

    promotions,

    commissionRates: {
      marketplace: 0.05,
      promotion: 0.03
    },

    statistics: {
      totalSales,
      commission,
      promotionCommission,
      sellerBalance,
      totalOrders: orders.length,
      totalProducts: products.length
    }
  };
}

/* =========================================================
   MAIN HANDLER
========================================================= */

export default async function handler(req) {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers
    });
  }

  if (req.method !== "GET") {
    return json(
      {
        error: "Method not allowed"
      },
      405
    );
  }

  try {
    const user = await getUser(req);

    if (!user) {
      return json(
        {
          error: "Login required."
        },
        401
      );
    }

    /*
     * Admin is identified by the authenticated
     * Supabase user's email.
     */
    if (
      String(user.email || "").toLowerCase() ===
      ADMIN_EMAIL.toLowerCase()
    ) {
      return json(
        await adminDashboard()
      );
    }

    /*
     * Normal user profile.
     */
    const {
      data: profile,
      error: profileError
    } = await supabase
      .from("profiles")
      .select(
        "id, phone, role, full_name"
      )
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return json(
        {
          error: "User profile not found."
        },
        404
      );
    }

    if (profile.role === "buyer") {
      return json(
        await buyerDashboard(
          user,
          profile
        )
      );
    }

    if (profile.role === "seller") {
      return json(
        await sellerDashboard(
          user,
          profile
        )
      );
    }

    return json(
      {
        error: "Unsupported account role."
      },
      403
    );

  } catch (error) {
    console.error(
      "DASHBOARD ERROR:",
      error
    );

    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load dashboard."
      },
      500
    );
  }
}

export const config = {
  path: "/api/dashboard"
};
