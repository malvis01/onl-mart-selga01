import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Netlify.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Netlify.env.get(
  "SUPABASE_SERVICE_ROLE_KEY"
);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Supabase environment variables are not configured.");
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

  try {
    const body = await req.json();

    const action = String(
      body.action || "login"
    );

    const role = String(
      body.role || ""
    );

    const phone = String(
      body.phone || ""
    ).trim();

    const password = String(
      body.password || ""
    );

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
     * Supabase Auth uses email internally.
     * Users still register/login with their phone.
     */
    const cleanPhone = phone.replace(
      /\D/g,
      ""
    );

    const authEmail =
      `${cleanPhone}@users.salgadigitalmart.local`;

    /*
     * =========================
     * REGISTER
     * =========================
     */
    if (action === "register") {

      if (role === "seller") {
        if (
          !String(body.businessName || "").trim() ||
          !String(body.bankName || "").trim() ||
          !String(body.accountNumber || "").trim()
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
       * Check existing profile.
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
              "Unable to check account. Please try again."
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
          "AUTH CREATE ERROR:",
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

      const user = authData.user;

      /*
       * Create profile.
       */
      const {
        data: profile,
        error: profileError
      } = await supabase
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
       * Seller business record.
       */
      if (role === "seller") {

        const {
          error: businessError
        } = await supabase
          .from("businesses")
          .insert({
            owner_id: user.id,
            business_name:
              String(
                body.businessName
              ).trim(),
            status: "active",
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
       * Log the new user in.
       */
      const {
        data: loginData,
        error: loginError
      } = await supabase.auth.signInWithPassword({
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
            error:
              "Account was created, but automatic login failed. Please log in."
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
     * =========================
     * LOGIN
     * =========================
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

    const {
      data: profile,
      error: profileError
    } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", authUser.id)
      .single();

    if (profileError || !profile) {
      return json(
        {
          error:
            "Your account profile could not be found."
        },
        404
      );
    }

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
      user: {
        id: authUser.id,
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
