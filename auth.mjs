import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
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

function getSupabase() {
  if (!SUPABASE_URL) {
    throw new Error("SUPABASE_URL is not configured in Netlify.");
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

function cleanPhone(value) {
  return String(value || "").trim();
}

function authEmailFor(phone) {
  const digits = phone.replace(/\D/g, "");

  if (!digits) {
    return "";
  }

  return `${digits}@users.salgadigitalmart.local`;
}

/*
 * ==========================================================
 * ENSURE SELLER BUSINESS PROFILE
 * ==========================================================
 *
 * If a seller already has an account but does not have a
 * business row, automatically create the business profile.
 *
 * Existing products are NOT deleted or modified.
 */
async function ensureSellerBusiness(
  supabase,
  user,
  profile,
  requestedName = ""
) {
  if (profile?.role !== "seller") {
    return null;
  }

  const {
    data: existing,
    error: lookupError
  } = await supabase
    .from("businesses")
    .select("*")
    .eq("owner_id", user.id)
    .order("id", {
      ascending: true
    })
    .limit(1)
    .maybeSingle();

  if (lookupError) {
    throw lookupError;
  }

  /*
   * Business already exists.
   */
  if (existing) {
    return existing;
  }

  /*
   * Existing seller has no business profile.
   */
  const businessName = String(
    requestedName ||
    profile.full_name ||
    user.user_metadata?.businessName ||
    user.user_metadata?.full_name ||
    "My Business"
  ).trim() || "My Business";

  const {
    data: created,
    error: createError
  } = await supabase
    .from("businesses")
    .insert({
      owner_id: user.id,
      business_name: businessName,
      status: "active"
    })
    .select("*")
    .single();

  if (createError) {
    throw createError;
  }

  return created;
}

export default async function handler(req) {

  if (req.method === "OPTIONS") {
    return new Response("ok", {
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

  try {

    const supabase = getSupabase();

    const body =
      await req.json().catch(() => ({}));

    const action =
      String(body.action || "login").trim();

    const role =
      String(body.role || "")
        .trim()
        .toLowerCase();

    const phone =
      cleanPhone(body.phone);

    const password =
      String(body.password || "");

    const businessName =
      String(body.businessName || "").trim();

    /*
     * Validate.
     */
    if (
      !phone ||
      !password ||
      !["buyer", "seller"].includes(role)
    ) {
      return json(
        {
          error:
            "Phone number, password and account type are required."
        },
        400
      );
    }

    const authEmail =
      authEmailFor(phone);

    if (!authEmail) {
      return json(
        {
          error:
            "Please enter a valid phone number."
        },
        400
      );
    }

    /*
     * ==========================================================
     * REGISTER
     * ==========================================================
     */
    if (action === "register") {

      if (
        role === "seller" &&
        !businessName
      ) {
        return json(
          {
            error:
              "Business name is required."
          },
          400
        );
      }

      /*
       * Check existing profile.
       */
      const {
        data: existingProfile,
        error: profileCheckError
      } = await supabase
        .from("profiles")
        .select(
          "id, phone, role"
        )
        .eq(
          "phone",
          phone
        )
        .maybeSingle();

      if (profileCheckError) {
        throw profileCheckError;
      }

      if (existingProfile) {
        return json(
          {
            error:
              "An account with this phone number already exists. Please log in instead."
          },
          409
        );
      }

      /*
       * Create Supabase Auth account.
       */
      const {
        data: authData,
        error: authError
      } = await supabase.auth.admin.createUser({
        email: authEmail,

        password,

        email_confirm: true,

        user_metadata: {
          phone,
          role,

          businessName:
            role === "seller"
              ? businessName
              : "",

          full_name:
            role === "seller"
              ? businessName
              : ""
        }
      });

      if (authError) {

        const message =
          String(
            authError.message || ""
          ).toLowerCase();

        if (
          message.includes("already") ||
          message.includes("duplicate")
        ) {
          return json(
            {
              error:
                "An account with this phone number already exists. Please log in instead."
            },
            409
          );
        }

        return json(
          {
            error:
              authError.message
          },
          400
        );
      }

      const user =
        authData.user;

      /*
       * Create/update application profile.
       */
      const {
        data: profile,
        error: profileError
      } = await supabase
        .from("profiles")
        .upsert(
          {
            id: user.id,

            phone,

            role,

            full_name:
              role === "seller"
                ? businessName
                : ""
          },
          {
            onConflict: "id"
          }
        )
        .select()
        .single();

      if (profileError) {

        try {
          await supabase.auth.admin.deleteUser(
            user.id
          );
        } catch (_) {}

        return json(
          {
            error:
              profileError.message
          },
          500
        );
      }

      /*
       * Create seller business profile.
       */
      let business = null;

      if (role === "seller") {

        try {

          business =
            await ensureSellerBusiness(
              supabase,
              user,
              profile,
              businessName
            );

        } catch (error) {

          try {
            await supabase.auth.admin.deleteUser(
              user.id
            );
          } catch (_) {}

          return json(
            {
              error:
                error.message ||
                "Could not create business profile."
            },
            400
          );
        }
      }

      /*
       * Automatically sign in.
       */
      const {
        data: loginData,
        error: loginError
      } = await supabase.auth.signInWithPassword({
        email: authEmail,
        password
      });

      /*
       * Account was successfully created even if
       * automatic login fails.
       */
      if (loginError) {

        return json(
          {
            success: true,

            message:
              "Account created successfully. Please log in.",

            user: {
              id: user.id,

              phone,

              role,

              full_name:
                profile.full_name || "",

              business:
                business || null
            }
          },
          201
        );
      }

      return json({
        success: true,

        message:
          "Account created successfully.",

        user: {
          id: user.id,

          phone,

          role,

          full_name:
            profile.full_name || "",

          business:
            business || null
        },

        session:
          loginData.session
      });
    }

    /*
     * ==========================================================
     * LOGIN
     * ==========================================================
     */
    const {
      data: loginData,
      error: loginError
    } = await supabase.auth.signInWithPassword({
      email: authEmail,
      password
    });

    if (loginError) {

      return json(
        {
          error:
            "Invalid phone number or password."
        },
        401
      );
    }

    const authUser =
      loginData.user;

    /*
     * Load application profile.
     */
    const {
      data: profile,
      error: profileError
    } = await supabase
      .from("profiles")
      .select("*")
      .eq(
        "id",
        authUser.id
      )
      .maybeSingle();

    if (profileError) {
      throw profileError;
    }

    if (!profile) {
      return json(
        {
          error:
            "Your account profile could not be found."
        },
        404
      );
    }

    /*
     * Verify account type.
     */
    if (profile.role !== role) {
      return json(
        {
          error:
            "This account does not belong to the selected account type."
        },
        403
      );
    }

    /*
     * ==========================================================
     * IMPORTANT SELLER FIX
     * ==========================================================
     *
     * This is the part that fixes the existing business-owner
     * account that has products but no business profile.
     *
     * On every seller login:
     *
     * 1. Look for the business.
     * 2. If it exists, use it.
     * 3. If it doesn't exist, create it automatically.
     * 4. Return the business to the frontend.
     *
     * Products are untouched.
     */
    let business = null;

    if (profile.role === "seller") {

      business =
        await ensureSellerBusiness(
          supabase,
          authUser,
          profile
        );
    }

    /*
     * Successful login.
     */
    return json({

      success: true,

      message:
        "Login successful.",

      user: {

        id:
          authUser.id,

        phone:
          profile.phone || phone,

        role:
          profile.role,

        full_name:
          profile.full_name || "",

        business:
          business || null
      },

      session:
        loginData.session
    });

  } catch (error) {

    console.error(
      "AUTH FUNCTION ERROR:",
      error
    );

    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Authentication failed."
      },
      500
    );
  }
}

export const config = {
  path: "/api/auth"
};
