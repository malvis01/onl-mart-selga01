import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const INTERNAL_EMAIL_DOMAIN = "users.salgadigitalmart.com";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, "Content-Type": "application/json" }
  });
}

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!SUPABASE_URL) return json({ error: "SUPABASE_URL is not configured in Netlify." }, 500);
  if (!SUPABASE_SERVICE_ROLE_KEY) return json({ error: "SUPABASE_SERVICE_ROLE_KEY is not configured in Netlify." }, 500);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  try {
    const body = await req.json();
    const action = String(body.action || "login").trim();
    const role = String(body.role || "").trim();
    const phone = String(body.phone || "").trim();
    const password = String(body.password || "");

    if (!phone || !password || !["buyer", "seller"].includes(role)) {
      return json({ error: "Phone number, password and account type are required." }, 400);
    }

    const cleanPhone = phone.replace(/\D/g, "");
    if (!cleanPhone) return json({ error: "Please enter a valid phone number." }, 400);

    // Phone numbers are the public login identifier. Supabase Auth still
    // requires an email-shaped identifier internally, so use a real domain.
    const authEmail = `${cleanPhone}@${INTERNAL_EMAIL_DOMAIN}`;

    if (action === "register") {
      const businessName = String(body.businessName || "").trim();
      if (role === "seller" && !businessName) {
        return json({ error: "Business name is required." }, 400);
      }

      const { data: existingProfile, error: existingProfileError } = await supabase
        .from("profiles")
        .select("id, phone, role")
        .eq("phone", phone)
        .maybeSingle();

      if (existingProfileError) return json({ error: existingProfileError.message }, 500);
      if (existingProfile) {
        return json({ error: "An account with this phone number already exists. Please log in instead." }, 409);
      }

      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email: authEmail,
        password,
        email_confirm: true,
        user_metadata: {
          phone,
          role,
          full_name: role === "seller" ? businessName : ""
        }
      });

      if (authError) {
        const message = String(authError.message || "").toLowerCase();
        if (message.includes("already registered") || message.includes("already exists") || message.includes("duplicate")) {
          return json({ error: "An account with this phone number already exists. Please log in instead." }, 409);
        }
        return json({ error: authError.message }, 400);
      }

      const user = authData.user;
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .upsert({
          id: user.id,
          phone,
          role,
          full_name: role === "seller" ? businessName : ""
        }, { onConflict: "id" })
        .select()
        .single();

      if (profileError) {
        try { await supabase.auth.admin.deleteUser(user.id); } catch {}
        return json({ error: profileError.message }, 500);
      }

      if (role === "seller") {
        const { data: existingBusiness, error: businessCheckError } = await supabase
          .from("businesses")
          .select("id")
          .eq("owner_id", user.id)
          .maybeSingle();

        if (businessCheckError) return json({ error: businessCheckError.message }, 500);

        if (!existingBusiness) {
          const { error: businessError } = await supabase
            .from("businesses")
            .insert({ owner_id: user.id, business_name: businessName, status: "active" });
          if (businessError) return json({ error: businessError.message }, 400);
        }
      }

      const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({
        email: authEmail,
        password
      });

      if (loginError) {
        return json({
          success: true,
          message: "Account created successfully. Please log in.",
          user: { id: user.id, phone, role, full_name: profile.full_name || "" }
        }, 201);
      }

      return json({
        success: true,
        message: "Account created successfully.",
        user: { id: user.id, phone, role, full_name: profile.full_name || "" },
        session: loginData.session
      });
    }

    const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({
      email: authEmail,
      password
    });

    if (loginError) return json({ error: "Invalid phone number or password." }, 401);

    const authUser = loginData.user;
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", authUser.id)
      .single();

    if (profileError || !profile) return json({ error: "Your account profile could not be found." }, 404);
    if (profile.role !== role) return json({ error: "This account does not belong to the selected account type." }, 403);

    return json({
      success: true,
      message: "Login successful.",
      user: {
        id: authUser.id,
        phone: profile.phone || phone,
        role: profile.role,
        full_name: profile.full_name || ""
      },
      session: loginData.session
    });
  } catch (error) {
    console.error("AUTH FUNCTION ERROR:", error);
    return json({ error: error instanceof Error ? error.message : "Authentication failed." }, 500);
  }
}

export const config = { path: "/api/auth" };
