import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  Netlify.env.get("SUPABASE_URL") ||
  Netlify.env.get("VITE_SUPABASE_URL");

const SUPABASE_KEY =
  Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  Netlify.env.get("VITE_SUPABASE_PUBLISHABLE_KEY");

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, apikey, x-client-info",
  "Access-Control-Allow-Methods":
    "GET, POST, PUT, DELETE, OPTIONS"
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

export default async (req) => {

  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers
    });
  }

  if (req.method !== "POST") {
    return json(
      { error: "Method not allowed" },
      405
    );
  }

  try {

    const body = await req.json();

    const action =
      body.action || "login";

    const role =
      body.role;

    const phone =
      String(body.phone || "").trim();

    const password =
      String(body.password || "");

    if (
      !phone ||
      !password ||
      !["buyer", "seller"].includes(role)
    ) {
      return json(
        {
          error:
            "Phone, password and role are required."
        },
        400
      );
    }

    /*
     * Internal email used by Supabase Auth
     * for phone/password accounts.
     */
    const authEmail =
      phone.replace(/\D/g, "") +
      "@users.salgadigitalmart.local";

    /*
     * ========================================================
     * REGISTER
     * ========================================================
     */
    if (action === "register") {

      if (role === "seller") {

        if (
          !body.businessName ||
          !body.bankName ||
          !body.accountNumber
        ) {
          return json(
            {
              error:
                "Business name, bank and account number are required."
            },
            400
          );
        }
      }

      /*
       * Check whether phone already exists.
       */
      const {
        data: existing
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

      if (existing) {
        return json(
          {
            error:
              "An account with this phone number already exists."
          },
          409
        );
      }

      /*
       * Create Supabase Auth user.
       */
      const {
        data: authData,
        error: authError
      } =
        await supabase.auth.admin.createUser({
          email: authEmail,
          password,
          email_confirm: true,
          user_metadata: {
            phone,
            role,
            full_name:
              body.businessName ||
              ""
          }
        });

      if (authError) {
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
       * Create application profile.
       */
      const {
        data: profile,
        error: profileError
      } =
        await supabase
          .from("profiles")
          .upsert(
            {
              id: user.id,
              phone,
              role,
              full_name:
                body.businessName ||
                body.full_name ||
                ""
            },
            {
              onConflict: "id"
            }
          )
          .select()
          .single();

      if (profileError) {

        await supabase.auth.admin.deleteUser(
          user.id
        );

        return json(
          {
            error:
              profileError.message
          },
          500
        );
      }

      /*
       * ======================================================
       * CREATE SELLER BUSINESS PROFILE
       * ======================================================
       *
       * Every newly registered seller gets a business record.
       */
      if (role === "seller") {

        const {
          error: businessError
        } =
          await supabase
            .from("businesses")
            .insert({
              owner_id:
                user.id,

              business_name:
                String(
                  body.businessName
                ).trim(),

              status:
                "active"
            });

        if (businessError) {

          await supabase.auth.admin.deleteUser(
            user.id
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

      /*
       * Sign the user in.
       */
      const {
        data: sessionData,
        error: signInError
      } =
        await supabase.auth.signInWithPassword({
          email: authEmail,
          password
        });

      if (signInError) {
        return json(
          {
            error:
              signInError.message
          },
          400
        );
      }

      return json({
        success: true,

        user: {
          id: user.id,
          phone,
          role,
          full_name:
            profile.full_name || ""
        },

        session:
          sessionData.session
      });
    }

    /*
     * ========================================================
     * LOGIN
     * ========================================================
     */

    const {
      data: sessionData,
      error: signInError
    } =
      await supabase.auth.signInWithPassword({
        email: authEmail,
        password
      });

    if (signInError) {
      return json(
        {
          error:
            "Invalid phone number or password."
        },
        401
      );
    }

    const authUser =
      sessionData.user;

    /*
     * Get profile.
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

    if (profileError || !profile) {
      return json(
        {
          error:
            "User profile not found."
        },
        404
      );
    }

    /*
     * Make sure selected account type
     * matches the actual account.
     */
    if (profile.role !== role) {
      return json(
        {
          error:
            "This account does not have the selected account type."
        },
        403
      );
    }

    /*
     * ========================================================
     * IMPORTANT SELLER FIX
     * ========================================================
     *
     * If an existing seller was registered before the
     * business-profile creation was working, create the
     * missing business automatically during login.
     *
     * This prevents:
     *
     * "Create your business profile before adding products"
     *
     * for existing legitimate seller accounts.
     */
    if (profile.role === "seller") {

      const {
        data: business,
        error: businessLookupError
      } =
        await supabase
          .from("businesses")
          .select(
            "id, business_name, status"
          )
          .eq(
            "owner_id",
            authUser.id
          )
          .limit(1)
          .maybeSingle();

      if (businessLookupError) {

        console.error(
          "BUSINESS LOOKUP ERROR:",
          businessLookupError
        );

        return json(
          {
            error:
              businessLookupError.message
          },
          500
        );
      }

      /*
       * Business does not exist.
       * Create it automatically.
       */
      if (!business) {

        const businessName =
          String(
            profile.full_name ||
            "My Business"
          ).trim();

        const {
          error: createBusinessError
        } =
          await supabase
            .from("businesses")
            .insert({
              owner_id:
                authUser.id,

              business_name:
                businessName,

              status:
                "active"
            });

        if (createBusinessError) {

          console.error(
            "CREATE BUSINESS ERROR:",
            createBusinessError
          );

          return json(
            {
              error:
                createBusinessError.message
            },
            500
          );
        }
      }
    }

    /*
     * Return successful login.
     */
    return json({
      success: true,

      user: {
        id:
          authUser.id,

        phone:
          profile.phone,

        role:
          profile.role,

        full_name:
          profile.full_name || ""
      },

      session:
        sessionData.session
    });

  } catch (error) {

    console.error(
      "AUTH ERROR:",
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
};

export const config = {
  path: "/api/auth"
};
