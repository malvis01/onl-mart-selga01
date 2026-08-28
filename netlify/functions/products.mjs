import { createClient } from "@supabase/supabase-js";

/*
 * SALGA Digital Mart - Products API
 *
 * Supports:
 * - JSON product creation
 * - multipart/form-data product creation
 * - product image upload to Supabase Storage
 * - automatic business-profile creation for existing sellers
 */

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

const STORAGE_BUCKET = "product-images";

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif"
]);

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, apikey, x-client-info",
  "Access-Control-Allow-Methods":
    "GET, POST, PUT, DELETE, OPTIONS",
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

/*
 * Create the server-side Supabase client.
 */
function getSupabase() {
  if (!SUPABASE_URL) {
    throw new Error(
      "SUPABASE_URL is not configured in Netlify."
    );
  }

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured in Netlify."
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

/*
 * Get the authenticated Supabase user.
 */
async function getUser(req, supabase) {
  const authorization =
    req.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  const token =
    authorization
      .substring(7)
      .trim();

  if (!token) {
    return null;
  }

  const {
    data,
    error
  } = await supabase.auth.getUser(token);

  if (error || !data?.user) {
    console.error(
      "AUTH USER ERROR:",
      error
    );

    return null;
  }

  return data.user;
}

/*
 * Safely convert values to text.
 */
function cleanText(
  value,
  fallback = ""
) {
  if (
    value === undefined ||
    value === null
  ) {
    return fallback;
  }

  return String(value).trim();
}

/*
 * Safely convert values to numbers.
 */
function parseNumber(
  value,
  fallback = null
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return fallback;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

/*
 * Determine image extension.
 */
function extensionForType(
  type,
  originalName = ""
) {
  const byType = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif"
  };

  if (byType[type]) {
    return byType[type];
  }

  const match =
    String(originalName)
      .toLowerCase()
      .match(/\.([a-z0-9]+)$/);

  return match?.[1] || "jpg";
}

/*
 * Check whether request is multipart.
 */
function isMultipart(req) {
  const contentType =
    req.headers.get("content-type") || "";

  return contentType
    .toLowerCase()
    .includes("multipart/form-data");
}

/*
 * Read JSON or multipart product data.
 */
async function readProductBody(req) {
  if (isMultipart(req)) {
    const form =
      await req.formData();

    let imageFile = null;

    /*
     * Accept several image field names.
     */
    for (const key of [
      "image",
      "image_file",
      "product_image",
      "productImage",
      "file",
      "photo"
    ]) {
      const value =
        form.get(key);

      if (
        value &&
        typeof value === "object" &&
        typeof value.arrayBuffer === "function"
      ) {
        imageFile = value;
        break;
      }
    }

    return {
      name:
        form.get("name"),

      description:
        form.get("description"),

      price:
        form.get("price"),

      category:
        form.get("category"),

      stock:
        form.get("stock"),

      image_url:
        form.get("image_url") ||
        form.get("imageUrl") ||
        form.get("imageURL") ||
        "",

      imageFile
    };
  }

  try {
    const body =
      await req.json();

    return {
      ...(body || {}),
      imageFile: null
    };
  } catch (_) {
    throw new Error(
      "Invalid product data. Send JSON or multipart/form-data."
    );
  }
}

/*
 * Upload product image to Supabase Storage.
 */
async function uploadProductImage(
  supabase,
  imageFile,
  userId
) {
  if (!imageFile) {
    return {
      imageUrl: "",
      storagePath: null
    };
  }

  const contentType =
    cleanText(
      imageFile.type
    ).toLowerCase();

  if (
    !ALLOWED_IMAGE_TYPES.has(
      contentType
    )
  ) {
    throw new Error(
      "Invalid product image type. Please use JPG, PNG, WEBP, or GIF."
    );
  }

  if (
    !Number.isFinite(
      imageFile.size
    ) ||
    imageFile.size <= 0
  ) {
    throw new Error(
      "The product image is empty or invalid."
    );
  }

  if (
    imageFile.size >
    MAX_IMAGE_SIZE
  ) {
    throw new Error(
      "Product image must be 5 MB or smaller."
    );
  }

  const extension =
    extensionForType(
      contentType,
      imageFile.name
    );

  const safeUserId =
    String(userId)
      .replace(
        /[^a-zA-Z0-9_-]/g,
        ""
      );

  const uniqueName =
    typeof crypto !== "undefined" &&
    crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()
          .toString(36)
          .slice(2)}`;

  const storagePath =
    `products/${safeUserId}/${uniqueName}.${extension}`;

  const arrayBuffer =
    await imageFile.arrayBuffer();

  const fileBuffer =
    Buffer.from(arrayBuffer);

  const {
    error: uploadError
  } =
    await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(
        storagePath,
        fileBuffer,
        {
          contentType,
          cacheControl: "31536000",
          upsert: false
        }
      );

  if (uploadError) {
    console.error(
      "PRODUCT IMAGE UPLOAD ERROR:",
      uploadError
    );

    throw new Error(
      `Product image upload failed: ${uploadError.message}`
    );
  }

  const {
    data: publicUrlData
  } =
    supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(
        storagePath
      );

  const imageUrl =
    publicUrlData?.publicUrl;

  if (!imageUrl) {
    try {
      await supabase.storage
        .from(STORAGE_BUCKET)
        .remove([
          storagePath
        ]);
    } catch (_) {}

    throw new Error(
      "Could not create the product image URL."
    );
  }

  return {
    imageUrl,
    storagePath
  };
}

/*
 * Find or automatically create the seller's
 * business profile.
 *
 * This fixes the problem where an existing seller
 * account has a profiles row but no businesses row.
 */
async function getOrCreateBusiness(
  supabase,
  user,
  profile
) {
  /*
   * First try to find the existing business.
   */
  const {
    data: existingBusiness,
    error: businessCheckError
  } =
    await supabase
      .from("businesses")
      .select(
        "id, business_name, status"
      )
      .eq(
        "owner_id",
        user.id
      )
      .limit(1)
      .maybeSingle();

  if (businessCheckError) {
    console.error(
      "BUSINESS LOOKUP ERROR:",
      businessCheckError
    );

    throw new Error(
      businessCheckError.message
    );
  }

  /*
   * Business already exists.
   */
  if (existingBusiness) {
    return existingBusiness;
  }

  /*
   * Business does not exist.
   *
   * Automatically create it using the seller's
   * existing profile information.
   */
  const businessName =
    cleanText(
      profile.full_name
    ) ||
    cleanText(
      user.user_metadata?.businessName
    ) ||
    cleanText(
      user.user_metadata?.full_name
    ) ||
    "My Business";

  const {
    data: createdBusiness,
    error: createBusinessError
  } =
    await supabase
      .from("businesses")
      .insert({
        owner_id:
          user.id,

        business_name:
          businessName,

        status:
          "active"
      })
      .select(
        "id, business_name, status"
      )
      .single();

  if (createBusinessError) {
    console.error(
      "AUTOMATIC BUSINESS CREATE ERROR:",
      createBusinessError
    );

    throw new Error(
      `Could not create your business profile: ${createBusinessError.message}`
    );
  }

  return createdBusiness;
}

export default async (req) => {
  /*
   * CORS preflight.
   */
  if (req.method === "OPTIONS") {
    return new Response(
      "ok",
      {
        headers
      }
    );
  }

  try {
    const supabase =
      getSupabase();

    /*
     * =====================================================
     * GET PRODUCTS
     * =====================================================
     */
    if (req.method === "GET") {
      const {
        data,
        error
      } =
        await supabase
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
          .neq(
            "status",
            "deleted"
          )
          .eq(
            "approved",
            true
          )
          .order(
            "created_at",
            {
              ascending: false
            }
          );

      if (error) {
        console.error(
          "GET PRODUCTS ERROR:",
          error
        );

        return json(
          {
            success: false,
            error:
              error.message
          },
          500
        );
      }

      return json({
        success: true,
        products:
          data || []
      });
    }

    /*
     * =====================================================
     * CREATE PRODUCT
     * =====================================================
     */
    if (req.method === "POST") {
      /*
       * ---------------------------------------------------
       * 1. Authenticate
       * ---------------------------------------------------
       */
      const user =
        await getUser(
          req,
          supabase
        );

      if (!user) {
        return json(
          {
            success: false,
            error:
              "Authentication required. Please log in again."
          },
          401
        );
      }

      /*
       * ---------------------------------------------------
       * 2. Load seller profile
       * ---------------------------------------------------
       */
      const {
        data: profile,
        error: profileError
      } =
        await supabase
          .from("profiles")
          .select(
            "id, role, phone, full_name"
          )
          .eq(
            "id",
            user.id
          )
          .maybeSingle();

      if (profileError) {
        console.error(
          "PROFILE LOOKUP ERROR:",
          profileError
        );

        return json(
          {
            success: false,
            error:
              profileError.message
          },
          500
        );
      }

      /*
       * If the profile is missing, do not allow upload.
       */
      if (!profile) {
        return json(
          {
            success: false,
            error:
              "User profile not found. Please log out and log in again."
          },
          404
        );
      }

      /*
       * ---------------------------------------------------
       * 3. Verify seller account
       * ---------------------------------------------------
       */
      if (
        profile.role !==
        "seller"
      ) {
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
       * ---------------------------------------------------
       * 4. Read product data
       * ---------------------------------------------------
       */
      let body;

      try {
        body =
          await readProductBody(
            req
          );
      } catch (error) {
        return json(
          {
            success: false,
            error:
              error instanceof Error
                ? error.message
                : "Invalid product data."
          },
          400
        );
      }

      /*
       * ---------------------------------------------------
       * 5. Product name
       * ---------------------------------------------------
       */
      const name =
        cleanText(
          body.name
        );

      if (!name) {
        return json(
          {
            success: false,
            error:
              "Product name is required."
          },
          400
        );
      }

      /*
       * ---------------------------------------------------
       * 6. Product price
       * ---------------------------------------------------
       */
      if (
        body.price ===
          undefined ||
        body.price ===
          null ||
        body.price === ""
      ) {
        return json(
          {
            success: false,
            error:
              "Product price is required."
          },
          400
        );
      }

      const price =
        parseNumber(
          body.price
        );

      if (
        !Number.isFinite(
          price
        ) ||
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
       * ---------------------------------------------------
       * 7. Stock
       * ---------------------------------------------------
       */
      const stock =
        body.stock ===
          undefined ||
        body.stock ===
          null ||
        body.stock === ""
          ? 0
          : parseNumber(
              body.stock
            );

      if (
        !Number.isFinite(
          stock
        ) ||
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
       * ---------------------------------------------------
       * 8. Find OR create business
       * ---------------------------------------------------
       *
       * THIS IS THE IMPORTANT FIX.
       *
       * Existing sellers without a businesses row
       * will automatically receive one.
       */
      let business;

      try {
        business =
          await getOrCreateBusiness(
            supabase,
            user,
            profile
          );
      } catch (error) {
        console.error(
          "BUSINESS SETUP ERROR:",
          error
        );

        return json(
          {
            success: false,
            error:
              error instanceof Error
                ? error.message
                : "Could not create your business profile."
          },
          400
        );
      }

      /*
       * ---------------------------------------------------
       * 9. Make sure business is active
       * ---------------------------------------------------
       *
       * Existing active businesses continue normally.
       */
      if (
        business.status !==
        "active"
      ) {
        return json(
          {
            success: false,
            error:
              "Your business is not active. Please contact customer support."
          },
          403
        );
      }

      /*
       * ---------------------------------------------------
       * 10. Image
       * ---------------------------------------------------
       */
      let imageUrl =
        cleanText(
          body.image_url ||
          body.image ||
          ""
        );

      let storagePath =
        null;

      /*
       * Upload actual image if supplied.
       */
      if (body.imageFile) {
        try {
          const uploaded =
            await uploadProductImage(
              supabase,
              body.imageFile,
              user.id
            );

          imageUrl =
            uploaded.imageUrl;

          storagePath =
            uploaded.storagePath;
        } catch (error) {
          return json(
            {
              success: false,
              error:
                error instanceof Error
                  ? error.message
                  : "Product image upload failed."
            },
            400
          );
        }
      }

      /*
       * ---------------------------------------------------
       * 11. Create product
       * ---------------------------------------------------
       *
       * Product is approved immediately so it can
       * appear on the marketplace.
       */
      const product = {
        business_id:
          business.id,

        name,

        description:
          cleanText(
            body.description
          ),

        price,

        image_url:
          imageUrl,

        category:
          cleanText(
            body.category,
            "Other"
          ) || "Other",

        stock:
          Math.floor(stock),

        status:
          "active",

        approved:
          true
      };

      const {
        data: created,
        error: createError
      } =
        await supabase
          .from("products")
          .insert(
            product
          )
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

      /*
       * ---------------------------------------------------
       * 12. Product creation error
       * ---------------------------------------------------
       */
      if (createError) {
        console.error(
          "CREATE PRODUCT ERROR:",
          createError
        );

        /*
         * Remove uploaded image if product creation
         * failed so we don't leave an orphaned file.
         */
        if (storagePath) {
          try {
            await supabase.storage
              .from(
                STORAGE_BUCKET
              )
              .remove([
                storagePath
              ]);
          } catch (
            cleanupError
          ) {
            console.error(
              "IMAGE CLEANUP ERROR:",
              cleanupError
            );
          }
        }

        return json(
          {
            success: false,
            error:
              createError.message
          },
          400
        );
      }

      /*
       * ---------------------------------------------------
       * 13. Success
       * ---------------------------------------------------
       */
      return json(
        {
          success: true,

          product:
            created,

          message:
            "Product uploaded successfully and is now live."
        },
        201
      );
    }

    /*
     * =====================================================
     * UNSUPPORTED METHOD
     * =====================================================
     */
    return json(
      {
        success: false,
        error:
          "Method not allowed"
      },
      405
    );

  } catch (error) {
    console.error(
      "PRODUCT API ERROR:",
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
