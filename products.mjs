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

/*
 * Get the currently authenticated Supabase user.
 */
async function getUser(req) {
  const authorization = req.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  const token = authorization.substring(7);

  const { data, error } =
    await supabase.auth.getUser(token);

  if (error || !data?.user) {
    return null;
  }

  return data.user;
}

export default async (req) => {
  /*
   * CORS preflight.
   */
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers
    });
  }

  try {
    /*
     * =========================================================
     * GET PRODUCTS
     * =========================================================
     *
     * Only products that are:
     * - not deleted
     * - approved by admin
     *
     * are returned publicly.
     */
    if (req.method === "GET") {
      const {
        data,
        error
      } = await supabase
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
        .order("created_at", {
          ascending: false
        });

      if (error) {
        console.error(
          "GET PRODUCTS ERROR:",
          error
        );

        return json(
          {
            error: error.message
          },
          500
        );
      }

      return json({
        products: data || []
      });
    }

    /*
     * =========================================================
     * CREATE PRODUCT
     * =========================================================
     *
     * Only authenticated sellers can create products.
     */
    if (req.method === "POST") {
      /*
       * -------------------------------------------------------
       * 1. Authenticate seller
       * -------------------------------------------------------
       */
      const user = await getUser(req);

      if (!user) {
        return json(
          {
            error: "Authentication required"
          },
          401
        );
      }

      /*
       * -------------------------------------------------------
       * 2. Get seller profile
       * -------------------------------------------------------
       */
      const {
        data: profile,
        error: profileError
      } = await supabase
        .from("profiles")
        .select(`
          id,
          role,
          phone,
          full_name
        `)
        .eq("id", user.id)
        .maybeSingle();

      if (profileError) {
        console.error(
          "PROFILE ERROR:",
          profileError
        );

        return json(
          {
            error: profileError.message
          },
          500
        );
      }

      if (!profile) {
        return json(
          {
            error:
              "User profile not found"
          },
          404
        );
      }

      /*
       * Only seller/business accounts can upload.
       */
      if (profile.role !== "seller") {
        return json(
          {
            error:
              "Only business owners can add products"
          },
          403
        );
      }

      /*
       * -------------------------------------------------------
       * 3. Read request body
       * -------------------------------------------------------
       */
      let body;

      try {
        body = await req.json();
      } catch {
        return json(
          {
            error:
              "Invalid product data"
          },
          400
        );
      }

      /*
       * -------------------------------------------------------
       * 4. Clean product information
       * -------------------------------------------------------
       */
      const name =
        String(body?.name || "").trim();

      const description =
        String(
          body?.description || ""
        ).trim();

      const category =
        String(
          body?.category || "Other"
        ).trim();

      /*
       * Accept either image_url or image.
       */
      const image_url =
        String(
          body?.image_url ||
          body?.image ||
          ""
        ).trim();

      const price =
        Number(body?.price);

      /*
       * Stock is optional.
       * If seller doesn't provide stock,
       * default to zero.
       */
      const stock =
        body?.stock === undefined ||
        body?.stock === null ||
        body?.stock === ""
          ? 0
          : Number(body.stock);

      /*
       * -------------------------------------------------------
       * 5. Validate product name
       * -------------------------------------------------------
       */
      if (!name) {
        return json(
          {
            error:
              "Product name is required"
          },
          400
        );
      }

      /*
       * -------------------------------------------------------
       * 6. Validate price
       * -------------------------------------------------------
       */
      if (
        !Number.isFinite(price) ||
        price <= 0
      ) {
        return json(
          {
            error:
              "Product price must be greater than zero"
          },
          400
        );
      }

      /*
       * -------------------------------------------------------
       * 7. Validate stock
       * -------------------------------------------------------
       */
      if (
        !Number.isFinite(stock) ||
        stock < 0
      ) {
        return json(
          {
            error:
              "Product stock must be zero or greater"
          },
          400
        );
      }

      /*
       * -------------------------------------------------------
       * 8. Find seller's business
       * -------------------------------------------------------
       *
       * The business MUST belong to the authenticated user.
       */
      const {
        data: business,
        error: businessError
      } = await supabase
        .from("businesses")
        .select(`
          id,
          business_name,
          status
        `)
        .eq("owner_id", user.id)
        .limit(1)
        .maybeSingle();

      if (businessError) {
        console.error(
          "BUSINESS LOOKUP ERROR:",
          businessError
        );

        return json(
          {
            error:
              businessError.message
          },
          500
        );
      }

      /*
       * Seller must have a business profile.
       */
      if (!business) {
        return json(
          {
            error:
              "Create your business profile before adding products"
          },
          400
        );
      }

      /*
       * -------------------------------------------------------
       * 9. Check business status
       * -------------------------------------------------------
       */
      if (
        business.status !==
        "active"
      ) {
        return json(
          {
            error:
              "Your business is not active"
          },
          403
        );
      }

      /*
       * -------------------------------------------------------
       * 10. Build product
       * -------------------------------------------------------
       *
       * Products are created as active but NOT approved.
       *
       * This means:
       * Seller uploads product
       *        ↓
       * Product enters database
       *        ↓
       * Admin approves product
       *        ↓
       * Product becomes publicly visible
       */
      const product = {
        business_id:
          business.id,

        name,

        description,

        price,

        image_url,

        category,

        stock:
          Math.floor(stock),

        status:
          "active",

        approved:
          false
      };

      /*
       * -------------------------------------------------------
       * 11. Insert product
       * -------------------------------------------------------
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
          "PRODUCT CREATE ERROR:",
          createError
        );

        return json(
          {
            error:
              createError.message
          },
          400
        );
      }

      /*
       * -------------------------------------------------------
       * 12. Successful upload
       * -------------------------------------------------------
       */
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

    /*
     * =========================================================
     * Unsupported method
     * =========================================================
     */
    return json(
      {
        error:
          "Method not allowed"
      },
      405
    );

  } catch (error) {
    /*
     * =========================================================
     * Global error handler
     * =========================================================
     */
    console.error(
      "PRODUCT ERROR:",
      error
    );

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
