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
  "Access-Control-Allow-Methods":
    "GET, POST, PUT, DELETE, OPTIONS"
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
     * Public marketplace products.
     * Products marked as deleted are hidden.
     * Seller products are created with approved=true,
     * so they appear immediately after upload.
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
        console.error("GET PRODUCTS ERROR:", error);

        return json(
          { error: error.message },
          500
        );
      }

      return json({
        success: true,
        products: data || []
      });
    }

    /*
     * CREATE PRODUCT
     *
     * Only authenticated sellers/business owners
     * can create products.
     */
    if (req.method === "POST") {
      const user = await getUser(req);

      if (!user) {
        return json(
          {
            success: false,
            error: "Authentication required. Please log in again."
          },
          401
        );
      }

      /*
       * Get the authenticated user's profile.
       */
      const {
        data: profile,
        error: profileError
      } = await supabase
        .from("profiles")
        .select(
          "id, role, phone, full_name"
        )
        .eq("id", user.id)
        .single();

      if (profileError || !profile) {
        console.error(
          "PROFILE LOOKUP ERROR:",
          profileError
        );

        return json(
          {
            success: false,
            error: "User profile not found."
          },
          404
        );
      }

      /*
       * Only sellers can upload products.
       */
      if (profile.role !== "seller") {
        return json(
          {
            success: false,
            error:
              "Only business owners can add products."
          },
          403
        );
      }

      /*
       * Read request body.
       */
      let body;

      try {
        body = await req.json();
      } catch {
        return json(
          {
            success: false,
            error: "Invalid product data."
          },
          400
        );
      }

      /*
       * Validate required fields.
       */
      if (
        !body.name ||
        String(body.name).trim() === ""
      ) {
        return json(
          {
            success: false,
            error: "Product name is required."
          },
          400
        );
      }

      if (
        body.price === undefined ||
        body.price === null ||
        body.price === ""
      ) {
        return json(
          {
            success: false,
            error: "Product price is required."
          },
          400
        );
      }

      /*
       * Find the seller's business profile.
       */
      const {
        data: business,
        error: businessError
      } = await supabase
        .from("businesses")
        .select(
          "id, business_name, status"
        )
        .eq("owner_id", user.id)
        .maybeSingle();

      if (businessError) {
        console.error(
          "BUSINESS LOOKUP ERROR:",
          businessError
        );

        return json(
          {
            success: false,
            error: businessError.message
          },
          500
        );
      }

      /*
       * Seller must create a business profile first.
       */
      if (!business) {
        return json(
          {
            success: false,
            error:
              "Create your business profile before adding products."
          },
          400
        );
      }

      /*
       * Business must be active.
       */
      if (business.status !== "active") {
        return json(
          {
            success: false,
            error:
              "Your business is not active. Please complete your business profile."
          },
          403
        );
      }

      /*
       * Convert and validate price.
       */
      const price = Number(body.price);

      if (
        !Number.isFinite(price) ||
        price <= 0
      ) {
        return json(
          {
            success: false,
            error:
              "Product price must be greater than zero."
          },
          400
        );
      }

      /*
       * Convert and validate stock.
       */
      const stock =
        body.stock === undefined ||
        body.stock === null ||
        body.stock === ""
          ? 0
          : Number(body.stock);

      if (
        !Number.isFinite(stock) ||
        stock < 0
      ) {
        return json(
          {
            success: false,
            error:
              "Product stock must be zero or greater."
          },
          400
        );
      }

      /*
       * Build the product.
       *
       * IMPORTANT:
       * approved is TRUE because sellers should not
       * need administrator approval before their
       * products appear on the marketplace.
       */
      const product = {
        business_id: business.id,

        name: String(body.name).trim(),

        description:
          String(
            body.description || ""
          ).trim(),

        price,

        image_url:
          String(
            body.image_url ||
            body.image ||
            ""
          ).trim(),

        category:
          String(
            body.category ||
            "Other"
          ).trim(),

        stock,

        status: "active",

        approved: true
      };

      /*
       * Insert the product into Supabase.
       */
      const {
        data: created,
        error: createError
      } = await supabase
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
        console.error(
          "CREATE PRODUCT ERROR:",
          createError
        );

        return json(
          {
            success: false,
            error: createError.message
          },
          400
        );
      }

      /*
       * Product was successfully created
       * and is immediately live.
       */
      return json(
        {
          success: true,

          product: created,

          message:
            "Product uploaded successfully and is now live."
        },
        201
      );
    }

    /*
     * Unsupported request method.
     */
    return json(
      {
        success: false,
        error: "Method not allowed"
      },
      405
    );

  } catch (error) {
    console.error(
      "PRODUCT ERROR:",
      error
    );

    return json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Product operation failed."
      },
      500
    );
  }
};

export const config = {
  path: "/api/products"
};
