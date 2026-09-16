import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "malvisdabz@gmail.com").toLowerCase();

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  }
});

async function getAdmin(req) {
  const header = req.headers.get("authorization") || "";
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;

  const user = data.user;
  const email = String(user.email || "").toLowerCase();
  if (email !== ADMIN_EMAIL) return null;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id,role,account_status")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || profile?.role !== "admin" || profile?.account_status === "restricted") return null;
  return user;
}

export default async function handler(req) {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !SUPABASE_KEY) return json({ error: "Supabase server configuration is missing." }, 500);

  const admin = await getAdmin(req);
  if (!admin) return json({ error: "Admin access required." }, 403);

  try {
    const { data, error } = await supabase
      .from("businesses")
      .select("id,business_name,owner_id,phone,whatsapp,status,created_at,profiles!businesses_owner_id_fkey(id,full_name,phone,created_at,account_status,role)")
      .order("created_at", { ascending: false });

    if (error) throw error;

    const { data: authData, error: authError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (authError) throw authError;
    const authById = new Map((authData?.users || []).map(user => [user.id, user]));

    const rows = (data || [])
      .filter(row => row.profiles?.role === "seller")
      .map(row => {
        const authUser = authById.get(row.owner_id);
        const accountPhone = String(authUser?.phone || "").trim();
        const businessPhone = String(row.phone || "").trim();
        const profilePhone = String(row.profiles?.phone || "").trim();
        const whatsapp = String(row.whatsapp || "").trim();
        return {
          business_id: row.id,
          business_name: row.business_name || "Unnamed business",
          owner_id: row.owner_id,
          owner_name: row.profiles?.full_name || "Not provided",
          account_phone: accountPhone || businessPhone || profilePhone || whatsapp || "Not provided",
          registration_date: authUser?.created_at || row.profiles?.created_at || row.created_at,
          account_status: row.profiles?.account_status || "active",
          business_status: row.status || "active"
        };
      });

    return json({ success: true, count: rows.length, businesses: rows });
  } catch (error) {
    console.error("ADMIN BUSINESS CONTACTS:", error);
    return json({ error: error?.message || "Unable to load business owner contacts." }, 500);
  }
}
