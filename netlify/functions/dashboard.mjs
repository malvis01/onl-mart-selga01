import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  Netlify.env.get("SUPABASE_URL");

const SUPABASE_KEY =
  Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

const ADMIN_EMAIL =
  "malvisdabz@gmail.com";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization",
  "Access-Control-Allow-Methods":
    "GET, OPTIONS"
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

async function getUser(req) {

  const authorization =
    req.headers.get(
      "authorization"
    );

  if (
    !authorization ||
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
    await supabase.auth.getUser(
      token
    );

  if (
    error ||
    !data ||
    !data.user
  ) {
    return null;
  }

  return data.user;
}

export default async function handler(
  req
) {

  if (
    req.method === "OPTIONS"
  ) {
    return new Response(
      "ok",
      { headers }
    );
  }

  if (
    req.method !== "GET"
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

    const user =
      await getUser(req);

    if (!user) {
      return json(
        {
          error:
            "Login required."
        },
        401
      );
    }

    /*
     * =====================================
     * ADMIN DASHBOARD
     * =====================================
     */

    const isAdmin =
      (user.email || "")
        .toLowerCase() ===
      ADMIN_EMAIL.toLowerCase();

    if (isAdmin) {

      const [
        usersResult,
        businessesResult,
        productsResult,
        ordersResult,
        transactionsResult,
        walletResult
      ] =
        await Promise.all([

          supabase
            .from("profiles")
            .select(
              "id, phone, role, full_name",
              {
                count: "exact"
              }
            ),

          supabase
            .from("businesses")
            .select(
              "id, owner_id, business_name, status",
              {
                count: "exact"
              }
            ),

          supabase
            .from("products")
            .select(
              "id, business_id, name, price, stock, status, approved",
              {
                count: "exact"
              }
            ),

          supabase
            .from("orders")
            .select(
              "id, buyer_id, business_id, total_amount, status, payment_status, created_at",
              {
                count: "exact"
              }
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
            .order(
              "completed_at",
              {
                ascending: false
              }
            ),

          supabase
            .from("platform_wallet")
            .select("*")
            .limit(1)
            .maybeSingle()
        ]);

      if (
        usersResult.error
      ) {
        throw usersResult.error;
      }

      if (
        businessesResult.error
      ) {
        throw businessesResult.error;
      }

      if (
        productsResult.error
      ) {
        throw productsResult.error;
      }

      if (
        ordersResult.error
      ) {
        throw ordersResult.error;
      }

      if (
        transactionsResult.error
      ) {
        throw transactionsResult.error;
      }

      return json({

        role: "admin",

        statistics: {

          totalUsers:
            usersResult.count || 0,

          buyers:
            (usersResult.data || [])
              .filter(
                u =>
                  u.role === "buyer"
              ).length,

          sellers:
            (usersResult.data || [])
              .filter(
                u =>
                  u.role === "seller"
              ).length,

          totalBusinesses:
            businessesResult.count ||
            0,

          totalProducts:
            productsResult.count ||
            0,

          totalOrders:
            ordersResult.count ||
            0
        },

        users:
          usersResult.data || [],

        businesses:
          businessesResult.data || [],

        products:
          productsResult.data || [],

        orders:
          ordersResult.data || [],

        transactions:
          transactionsResult.data || [],

        wallet:
          walletResult.data || null
      });
    }

    /*
     * =====================================
     * GET PROFILE
     * =====================================
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
        .single();

    if (
      profileError ||
      !profile
    ) {
      return json(
        {
          error:
            "User profile not found."
        },
        404
      );
    }

    /*
     * =====================================
     * BUYER DASHBOARD
     * =====================================
     */

    if (
      profile.role ===
      "buyer"
    ) {

      const [
        ordersResult,
        conversationsResult
      ] =
        await Promise.all([

          supabase
            .from("orders")
            .select(`
              id,
              business_id,
              total_amount,
              delivery_fee,
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
            .eq(
              "buyer_id",
              user.id
            )
            .order(
              "created_at",
              {
                ascending: false
              }
            ),

          supabase
            .from(
              "chat_conversations"
            )
            .select("*")
            .eq(
              "buyer_id",
              user.id
            )
        ]);

      if (
        ordersResult.error
      ) {
        throw ordersResult.error;
      }

      return json({

        role: "buyer",

        profile,

        orders:
          ordersResult.data ||
          [],

        conversations:
          conversationsResult.data ||
          [],

        statistics: {

          totalOrders:
            (ordersResult.data || [])
              .length,

          completedOrders:
            (ordersResult.data || [])
              .filter(
                order =>
                  order.status ===
                  "completed"
              ).length,

          totalSpent:
            (ordersResult.data || [])
              .filter(
                order =>
                  order.payment_status ===
                  "paid"
              )
              .reduce(
                (
                  total,
                  order
                ) =>
                  total +
                  Number(
                    order.total_amount ||
                    0
                  ),
                0
              )
        }
      });
    }

    /*
     * =====================================
     * SELLER DASHBOARD
     * =====================================
     */

    if (
      profile.role ===
      "seller"
    ) {

      const {
        data: businesses,
        error:
          businessesError
      } =
        await supabase
          .from("businesses")
          .select("*")
          .eq(
            "owner_id",
            user.id
          );

      if (
        businessesError
      ) {
        throw businessesError;
      }

      const businessIds =
        (businesses || [])
          .map(
            business =>
              business.id
          );

      if (
        !businessIds.length
      ) {

        return json({

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
        });
      }

      const [
        productsResult,
        ordersResult,
        transactionsResult
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
            .select(`
              id,
              buyer_id,
              business_id,
              total_amount,
              delivery_fee,
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
            )
        ]);

      if (
        productsResult.error
      ) {
        throw productsResult.error;
      }

      if (
        ordersResult.error
      ) {
        throw ordersResult.error;
      }

      if (
        transactionsResult.error
      ) {
        throw transactionsResult.error;
      }

      const transactions =
        transactionsResult.data ||
        [];

      const totalSales =
        transactions
          .filter(
            transaction =>
              transaction.status ===
              "completed"
          )
          .reduce(
            (
              total,
              transaction
            ) =>
              total +
              Number(
                transaction.gross_amount ||
                0
              ),
            0
          );

      const commission =
        transactions
          .filter(
            transaction =>
              transaction.status ===
              "completed"
          )
          .reduce(
            (
              total,
              transaction
            ) =>
              total +
              Number(
                transaction.commission_amount ||
                0
              ),
            0
          );

      const sellerBalance =
        transactions
          .filter(
            transaction =>
              transaction.status ===
              "completed"
          )
          .reduce(
            (
              total,
              transaction
            ) =>
              total +
              Number(
                transaction.seller_amount ||
                0
              ),
            0
          );

      return json({

        role: "seller",

        profile,

        businesses:
          businesses || [],

        products:
          productsResult.data ||
          [],

        orders:
          ordersResult.data ||
          [],

        transactions,

        statistics: {

          totalSales,

          commission,

          sellerBalance,

          totalOrders:
            (ordersResult.data || [])
              .length,

          totalProducts:
            (productsResult.data || [])
              .length
        }
      });
    }

    return json(
      {
        error:
          "Unsupported account role."
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
  path:
    "/api/dashboard"
};
