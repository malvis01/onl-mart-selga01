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
        "Content-Type":
          "application/json"
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
        error:
          "Method not allowed"
      },
      405
    );
  }

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

  const supabase =
    createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          autoRefreshToken:
            false,
          persistSession:
            false
        }
      }
    );

  try {

    const body =
      await req.json();

    const action =
      String(
        body.action || "login"
      ).trim();

    const role =
      String(
        body.role || ""
      ).trim();

    const phone =
      String(
        body.phone || ""
      ).trim();

    const password =
      String(
        body.password || ""
      );

    /*
     * Validate basic information.
     */
    if (
      !phone ||
      !password ||
      !["buyer", "seller"].includes(
        role
      )
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
     * Customers still use their phone number.
     */
    const cleanPhone =
      phone.replace(
        /\D/g,
        ""
      );

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
    if (
      action === "register"
    ) {

      const businessName =
        String(
          body.businessName || ""
        ).trim();

      const bankName =
        String(
          body.bankName || ""
        ).trim();

      const bankCode =
        String(
          body.bankCode || ""
        ).trim();

      const accountNumber =
        String(
          body.accountNumber || ""
        ).trim();

      /*
       * Seller validation.
       */
      if (
        role === "seller"
      ) {

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
       * Check whether a profile with this
       * phone number already exists.
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

      if (
        existingProfileError
      ) {

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

      if (
        existingProfile
      ) {

        return json(
          {
            error:
              "An account with this phone number already exists. Please log in instead."
          },
          409
        );
      }

      /*
       * Create the real Supabase Auth user.
       */
      const {
        data: authData,
        error: authError
      } =
        await supabase
          .auth
          .admin
          .createUser({
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

      /*
       * If the Auth user already exists but
       * the profile check did not find it,
       * return a useful message instead of
       * exposing a database error.
       */
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
       * Create/update the application profile.
       *
       * IMPORTANT:
       * We use UPSERT instead of INSERT because
       * another Supabase process may have already
       * created the profile.
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

      if (
        profileError
      ) {

        console.error(
          "PROFILE UPSERT ERROR:",
          profileError
        );

        /*
         * Remove the Auth account only if
         * the profile could not be created.
         */
        try {
          await supabase
            .auth
            .admin
            .deleteUser(
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
       * SELLER BUSINESS RECORD
       * ==================================================
       */
      if (
        role === "seller"
      ) {

        /*
         * Check whether the business already exists.
         */
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

        if (
          businessCheckError
        ) {

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
         * Only create the business record
         * if one doesn't already exist.
         */
        if (
          !existingBusiness
        ) {

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
                  "active",

                bank_name:
                  bankName,

                bank_code:
                  bankCode,

                account_number:
                  accountNumber
              });

          if (
            businessError
          ) {

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
       * AUTOMATIC LOGIN AFTER REGISTRATION
       * ==================================================
       */
      const {
        data: loginData,
        error: loginError
      } =
        await supabase
          .auth
          .signInWithPassword({
            email:
              authEmail,

            password:
              password
          });

      /*
       * The account itself was successfully
       * created even if automatic login fails.
       */
      if (
        loginError
      ) {

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
       * Registration successful.
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
      await supabase
        .auth
        .signInWithPassword({
          email:
            authEmail,

          password:
            password
        });

    if (
      loginError
    ) {

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
     * Get the application profile.
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
     * Make sure the selected account type
     * matches the actual account.
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

  } catch (
    error
  ) {

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
