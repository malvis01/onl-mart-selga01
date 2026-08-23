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
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS"
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

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    return null;
  }

  return data.user;
}

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  try {
    /*
     * GET PRODUCTS
     *
     * Only approved, non-deleted products are shown publicly.
     */
    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("products")
        .select(`
          id,
          business_id,
          name,
          description,
          price,
          image_url,
          category,
          stock,
          status,
          approved,
          created_at,
          businesses (
            id,
            business_name,
            logo_url,
            verified
          )
        `)
        .neq("status", "deleted")
        .eq("approved", true)
        .order("created_at", { ascending: false });

      if (error) {
        return json({ error: error.message }, 500);
      }

      return json({
        products: data || []
      });
    }

    /*
     * CREATE PRODUCT
     *
     * Only authenticated sellers/business owners can create products.
     */
    if (req.method === "POST") {
      const user = await getUser(req);

      if (!user) {
        return json(
          { error: "Authentication required" },
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

      if (profile.role !== "seller") {
        return json(
          { error: "Only business owners can add products" },
          403
        );
      }

      const body = await req.json();

      if (!body.name || body.price === undefined) {
        return json(
          { error: "Product name and price are required" },
          400
        );
      }

      /*
       * Find the seller's real business.
       */
      const { data: business, error: businessError } =
        await supabase
          .from("businesses")
          .select("id, business_name, status")
          .eq("owner_id", user.id)
          .maybeSingle();

      if (businessError) {
        return json(
          { error: businessError.message },
          500
        );
      }

      if (!business) {
        return json(
          {
            error:
              "Create your business profile before adding products"
          },
          400
        );
      }

      if (business.status !== "active") {
        return json(
          { error: "Your business is not active" },
          403
        );
      }

      const product = {
        business_id: business.id,
        name: String(body.name).trim(),
        description: String(body.description || "").trim(),
        price: Number(body.price),
        image_url: String(body.image_url || body.image || "").trim(),
        category: String(body.category || "Other").trim(),
        stock: Number.isFinite(Number(body.stock))
          ? Number(body.stock)
          : 0,
        status: "active",

        /*
         * New seller products require admin approval.
         * This prevents unapproved products appearing publicly.
         */
        approved: false
      };

      if (
        !Number.isFinite(product.price) ||
        product.price <= 0
      ) {
        return json(
          { error: "Product price must be greater than zero" },
          400
        );
      }

      const { data: created, error: createError } =
        await supabase
          .from("products")
          .insert(product)
          .select(`
            id,
            business_id,
            name,
            description,
            price,
            image_url,
            category,
            stock,
            status,
            approved,
            created_at
          `)
          .single();

      if (createError) {
        return json(
          { error: createError.message },
          400
        );
      }

      return json(
        {
          success: true,
          product: created,
          message:
            "Product submitted successfully and is awaiting admin approval."
        },
        201
      );
    }

    return json(
      { error: "Method not allowed" },
      405
    );

  } catch (error) {
    console.error("PRODUCT ERROR:", error);

    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Product operation failed"
      },
      500
    );
  }
};

export const config = {
  path: "/api/products"
};
