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
    return new Response("ok", { headers });
  }

  if (req.method !== "POST") {
    return json(
      { error: "Method not allowed" },
      405
    );
  }

  if (!SUPABASE_URL) {
    return json(
      { error: "SUPABASE_URL is not configured in Netlify." },
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
     * Phone numbers are converted to an internal
     * email address for Supabase Auth.
     *
     * The customer still uses ONLY their phone
     * number when registering and logging in.
     */
    const cleanPhone =
      phone.replace(/\D/g, "");

    const authEmail =
      `${cleanPhone}@users.salgadigitalmart.local`;

    /*
     * ==========================================
     * REGISTER
     * ==========================================
     */
    if (action === "register") {

      /*
       * Seller-required information.
       */
      if (role === "seller") {

        const businessName =
          String(
            body.businessName || ""
          ).trim();

        const bankName =
          String(
            body.bankName || ""
          ).trim();

        const accountNumber =
          String(
            body.accountNumber || ""
          ).trim();

        if (
          !businessName ||
          !bankName ||
          !accountNumber
        ) {
          return json(
            {
              error:
                "Business name, bank name and account number are required."
            },
            400
          );
        }
      }

      /*
       * Check whether phone number already exists.
       */
      const {
        data: existing,
        error: existingError
      } = await supabase
        .from("profiles")
        .select("id, phone, role")
        .eq("phone", phone)
        .maybeSingle();

      if (existingError) {

        console.error(
          "PROFILE CHECK ERROR:",
          existingError
        );

        return json(
          {
            error:
              "Unable to check the account. Please try again."
          },
          500
        );
      }

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
       * Create the real Supabase Auth account.
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
              role === "seller"
                ? String(
                    body.businessName || ""
                  ).trim()
                : ""
          }
        });

      if (authError) {

        console.error(
          "SUPABASE AUTH CREATE ERROR:",
          authError
        );

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
       * Create the application profile.
       */
      const {
        data: profile,
        error: profileError
      } =
        await supabase
          .from("profiles")
          .insert({
            id: user.id,
            phone,
            role,

            full_name:
              role === "seller"
                ? String(
                    body.businessName || ""
                  ).trim()
                : ""
          })
          .select()
          .single();

      if (profileError) {

        console.error(
          "PROFILE CREATE ERROR:",
          profileError
        );

        /*
         * Remove Auth user if profile creation
         * failed so we don't leave a broken account.
         */
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
       * Create seller business record.
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
                "active",

              bank_name:
                String(
                  body.bankName || ""
                ).trim(),

              bank_code:
                String(
                  body.bankCode || ""
                ).trim(),

              account_number:
                String(
                  body.accountNumber || ""
                ).trim()
            });

        if (businessError) {

          console.error(
            "BUSINESS CREATE ERROR:",
            businessError
          );

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
       * Automatically log the new account in.
       */
      const {
        data: loginData,
        error: loginError
      } =
        await supabase.auth.signInWithPassword({
          email: authEmail,
          password
        });

      if (loginError) {

        console.error(
          "AUTO LOGIN ERROR:",
          loginError
        );

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
                profile.full_name || ""
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
            profile.full_name || ""
        },

        session:
          loginData.session
      });
    }

    /*
     * ==========================================
     * LOGIN
     * ==========================================
     */

    const {
      data: loginData,
      error: loginError
    } =
      await supabase.auth.signInWithPassword({
        email: authEmail,
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
     * Get application profile.
     */
    const {
      data: profile,
      error: profileError
    } =
      await supabase
        .from("profiles")
        .select("*")
        .eq("id", authUser.id)
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
     * Make sure buyer/seller selected on the
     * website matches the actual account role.
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
          profile.full_name || ""
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
