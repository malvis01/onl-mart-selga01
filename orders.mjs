import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  Netlify.env.get("SUPABASE_URL") ||
  Netlify.env.get("VITE_SUPABASE_URL");

const SUPABASE_KEY =
  Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  Netlify.env.get("VITE_SUPABASE_PUBLISHABLE_KEY");

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, apikey, x-client-info",
  "Access-Control-Allow-Methods": "GET, OPTIONS"
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

async function getUser(req) {
  const authorization = req.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  const token = authorization.substring(7);

  const { data, error } =
    await supabase.auth.getUser(token);

  if (error || !data.user) {
    return null;
  }

  return data.user;
}

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  if (req.method !== "GET") {
    return json(
      { error: "Method not allowed" },
      405
    );
  }

  try {
    const user = await getUser(req);

    if (!user) {
      return json(
        { error: "Login required" },
        401
      );
    }

    const { data: profile, error: profileError } =
      await supabase
        .from("profiles")
        .select("id, role, phone, full_name")
        .eq("id", user.id)
        .single();

    if (profileError || !profile) {
      return json(
        { error: "User profile not found" },
        404
      );
    }

    /*
     * BUYER ORDERS
     */
    if (profile.role === "buyer") {
      const { data: orders, error } =
        await supabase
          .from("orders")
          .select(`
            id,
            buyer_id,
            business_id,
            total_amount,
            delivery_fee,
            status,
            payment_status,
            notes,
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
          .order("created_at", {
            ascending: false
          });

      if (error) {
        return json(
          { error: error.message },
          500
        );
      }

      return json({
        orders: orders || []
      });
    }

    /*
     * SELLER / BUSINESS OWNER ORDERS
     *
     * Find businesses owned by this seller first.
     */
    if (profile.role === "seller") {
      const { data: businesses, error: businessError } =
        await supabase
          .from("businesses")
          .select("id")
          .eq("owner_id", user.id);

      if (businessError) {
        return json(
          { error: businessError.message },
          500
        );
      }

      const businessIds =
        (businesses || []).map(
          business => business.id
        );

      if (!businessIds.length) {
        return json({
          orders: []
        });
      }

      const { data: orders, error } =
        await supabase
          .from("orders")
          .select(`
            id,
            buyer_id,
            business_id,
            total_amount,
            delivery_fee,
            status,
            payment_status,
            notes,
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
          .in("business_id", businessIds)
          .order("created_at", {
            ascending: false
          });

      if (error) {
        return json(
          { error: error.message },
          500
        );
      }

      return json({
        orders: orders || []
      });
    }

    return json(
      { error: "Unsupported account role" },
      403
    );

  } catch (error) {
    console.error("ORDERS ERROR:", error);

    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load orders"
      },
      500
    );
  }
};

export const config = {
  path: "/api/orders"
};
