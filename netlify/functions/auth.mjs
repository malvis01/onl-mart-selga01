import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

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

  /*
   * Check Netlify environment variables.
   */
  if (!SUPABASE_URL) {
    return json(
      {
        error:
          "SUPABASE_URL is not configured in Netlify."
      },
      500
    );
  }

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return json(
      {
        error:
          "SUPABASE_SERVICE_ROLE_KEY is not configured in Netlify."
      },
      500
    );
  }

  /*
   * Server-side Supabase client.
   */
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

  try {

    const body = await req.json();

    const action =
      String(body.action || "login").trim();

    const role =
      String(body.role || "").trim();

    const phone =
      String(body.phone || "").trim();

    const password =
      String(body.password || "");

    /*
     * Validate account type and credentials.
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

    /*
     * Convert phone number into an internal
     * Supabase Auth email.
     *
     * The user still uses their phone number
     * on the website.
     */
    const cleanPhone =
      phone.replace(/\D/g, "");

    if (!cleanPhone) {
      return json(
        {
          error:
            "Please enter a valid phone number."
        },
        400
      );
    }

    const authEmail =
      `${cleanPhone}@users.salgadigitalmart.local`;

    /*
     * ==================================================
     * REGISTER
     * ==================================================
     */
    if (action === "register") {

      const businessName =
        String(
          body.businessName || ""
        ).trim();

      /*
       * Seller validation.
       */
      if (role === "seller") {

        if (!businessName) {
          return json(
            {
              error:
                "Business name is required."
            },
            400
          );
        }
      }

      /*
       * Check whether this phone already has
       * an application profile.
       */
      const {
        data: existingProfile,
        error: existingProfileError
      } =
        await supabase
          .from("profiles")
          .select(
            "id, phone, role"
          )
          .eq(
            "phone",
            phone
          )
          .maybeSingle();

      if (existingProfileError) {

        console.error(
          "PROFILE CHECK ERROR:",
          existingProfileError
        );

        return json(
          {
            error:
              existingProfileError.message
          },
          500
        );
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
       * Create the real Supabase Auth account.
       */
      const {
        data: authData,
        error: authError
      } =
        await supabase.auth.admin.createUser({
          email:
            authEmail,

          password:
            password,

          email_confirm:
            true,

          user_metadata: {
            phone:
              phone,

            role:
              role,

            full_name:
              role === "seller"
                ? businessName
                : ""
          }
        });

      if (authError) {

        console.error(
          "AUTH CREATE ERROR:",
          authError
        );

        const message =
          String(
            authError.message || ""
          ).toLowerCase();

        if (
          message.includes(
            "already registered"
          ) ||
          message.includes(
            "already exists"
          ) ||
          message.includes(
            "duplicate"
          )
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
       * ==================================================
       * PROFILE
       * ==================================================
       *
       * Use UPSERT because Supabase may already create
       * a profile through a database trigger.
       */
      const {
        data: profile,
        error: profileError
      } =
        await supabase
          .from("profiles")
          .upsert(
            {
              id:
                user.id,

              phone:
                phone,

              role:
                role,

              full_name:
                role === "seller"
                  ? businessName
                  : ""
            },
            {
              onConflict:
                "id"
            }
          )
          .select()
          .single();

      if (profileError) {

        console.error(
          "PROFILE UPSERT ERROR:",
          profileError
        );

        /*
         * Clean up the Auth account if profile
         * creation/update fails.
         */
        try {
          await supabase.auth.admin.deleteUser(
            user.id
          );
        } catch (
          cleanupError
        ) {
          console.error(
            "AUTH CLEANUP ERROR:",
            cleanupError
          );
        }

        return json(
          {
            error:
              profileError.message
          },
          500
        );
      }

      /*
       * ==================================================
       * SELLER BUSINESS
       * ==================================================
       *
       * IMPORTANT:
       * We only use columns confirmed to exist
       * in the current businesses table.
       *
       * We intentionally DO NOT send:
       * account_number
       * bank_name
       * bank_code
       */
      if (role === "seller") {

        const {
          data: existingBusiness,
          error: businessCheckError
        } =
          await supabase
            .from("businesses")
            .select("id")
            .eq(
              "owner_id",
              user.id
            )
            .maybeSingle();

        if (businessCheckError) {

          console.error(
            "BUSINESS CHECK ERROR:",
            businessCheckError
          );

          return json(
            {
              error:
                businessCheckError.message
            },
            500
          );
        }

        /*
         * Only create the business if one does
         * not already exist.
         */
        if (!existingBusiness) {

          const {
            error: businessError
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
              });

          if (businessError) {

            console.error(
              "BUSINESS CREATE ERROR:",
              businessError
            );

            return json(
              {
                error:
                  businessError.message
              },
              400
            );
          }
        }
      }

      /*
       * ==================================================
       * AUTOMATIC LOGIN
       * ==================================================
       */
      const {
        data: loginData,
        error: loginError
      } =
        await supabase.auth.signInWithPassword({
          email:
            authEmail,

          password:
            password
        });

      /*
       * Account was created even if automatic
       * login fails.
       */
      if (loginError) {

        console.error(
          "AUTO LOGIN ERROR:",
          loginError
        );

        return json(
          {
            success:
              true,

            message:
              "Account created successfully. Please log in.",

            user: {
              id:
                user.id,

              phone:
                phone,

              role:
                role,

              full_name:
                profile.full_name ||
                ""
            }
          },
          201
        );
      }

      /*
       * Registration completed successfully.
       */
      return json({
        success:
          true,

        message:
          "Account created successfully.",

        user: {
          id:
            user.id,

          phone:
            phone,

          role:
            role,

          full_name:
            profile.full_name ||
            ""
        },

        session:
          loginData.session
      });
    }

    /*
     * ==================================================
     * LOGIN
     * ==================================================
     */

    const {
      data: loginData,
      error: loginError
    } =
      await supabase.auth.signInWithPassword({
        email:
          authEmail,

        password:
          password
      });

    if (loginError) {

      console.error(
        "LOGIN ERROR:",
        loginError
      );

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
    } =
      await supabase
        .from("profiles")
        .select("*")
        .eq(
          "id",
          authUser.id
        )
        .single();

    if (
      profileError ||
      !profile
    ) {

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
    if (
      profile.role !== role
    ) {

      return json(
        {
          error:
            "This account does not belong to the selected account type."
        },
        403
      );
    }

    /*
     * Login successful.
     */
    return json({
      success:
        true,

      message:
        "Login successful.",

      user: {
        id:
          authUser.id,

        phone:
          profile.phone ||
          phone,

        role:
          profile.role,

        full_name:
          profile.full_name ||
          ""
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
  path:
    "/api/auth"
};
