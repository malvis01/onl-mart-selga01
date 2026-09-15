import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL;
const ADMIN_EMAIL = "malvisdabz@gmail.com";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });

async function getUser(req) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const { data, error } = await supabase.auth.getUser(auth.slice(7).trim());
  return error || !data?.user ? null : data.user;
}

function hash(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }
function pinHash(pin) { return crypto.scryptSync(String(pin), "salga-withdrawal-pin-v1", 32).toString("hex"); }
function validPin(pin) { return /^\d{4}$/.test(String(pin || "")); }
function validAccount(account) { return /^\d{10}$/.test(String(account || "").replace(/\D/g, "")); }

async function paystack(path, options = {}) {
  return fetch("https://api.paystack.co" + path, { ...options, headers: { Authorization: `Bearer ${PAYSTACK_SECRET}`, "Content-Type": "application/json", ...(options.headers || {}) } });
}

async function resolveAccount(bankCode, accountNumber) {
  const response = await paystack(`/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`);
  const data = await response.json();
  if (!response.ok || !data.status || !data.data?.account_name) throw new Error(data.message || "Bank account could not be verified.");
  return data.data.account_name;
}

async function createRecipient({ bankCode, accountNumber, accountName }) {
  const response = await paystack("/transferrecipient", { method: "POST", body: JSON.stringify({ type: "nuban", name: accountName, account_number: accountNumber, bank_code: bankCode, currency: "NGN", description: "SALGA Digital Mart withdrawal" }) });
  const data = await response.json();
  if (!response.ok || !data.status || !data.data?.recipient_code) throw new Error(data.message || "Paystack could not create the payout recipient.");
  return data.data;
}

async function sendAdminOtp(email, code) {
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) throw new Error("Withdrawal email service is not configured. Add RESEND_API_KEY and RESEND_FROM_EMAIL in Netlify.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: RESEND_FROM_EMAIL, to: [email], subject: "SALGA Digital Mart withdrawal verification code", html: `<div style="font-family:Arial,sans-serif"><h2>SALGA Digital Mart</h2><p>Your administrator withdrawal verification code is:</p><p style="font-size:30px;font-weight:800;letter-spacing:8px">${code}</p><p>This 5-digit code expires in 10 minutes. If you did not start a withdrawal, do not use this code.</p></div>` })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "The verification email could not be sent.");
}

async function sellerRequest(u, body) {
  const amount = Number(body.amount);
  const pin = String(body.pin || "");
  if (!Number.isFinite(amount) || amount <= 0) return json({ error: "Enter a valid withdrawal amount." }, 400);
  if (!validPin(pin)) return json({ error: "Enter your 4-digit SALGA withdrawal PIN." }, 400);
  if (!PAYSTACK_SECRET) return json({ error: "Paystack secret key is not configured." }, 503);

  const { data: business, error: be } = await supabase.from("businesses").select("id,owner_id,business_name,bank_name,bank_code,account_number,account_name,payout_recipient_code,withdrawal_pin_hash,withdrawal_pin_set_at").eq("owner_id", u.id).order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (be) throw be;
  if (!business) return json({ error: "Business profile not found." }, 404);
  if (!business.bank_code || !validAccount(business.account_number)) return json({ error: "Your verified business bank account is incomplete. Update your payout details first." }, 400);

  if (!business.withdrawal_pin_hash) {
    const { error } = await supabase.from("businesses").update({ withdrawal_pin_hash: pinHash(pin), withdrawal_pin_set_at: new Date().toISOString() }).eq("id", business.id).eq("owner_id", u.id);
    if (error) throw error;
  } else if (business.withdrawal_pin_hash !== pinHash(pin)) {
    return json({ error: "Incorrect SALGA withdrawal PIN." }, 401);
  }

  const { data: balance, error: balanceError } = await supabase.rpc("seller_available_balance", { p_seller_id: u.id });
  if (balanceError) throw balanceError;
  const available = Number(balance || 0);
  if (available <= 0) return json({ error: "No seller funds are currently available for withdrawal. Funds remain safely in your SALGA balance until an order is completed." }, 400);
  if (amount > available) return json({ error: `Withdrawal amount exceeds your available balance of ₦${available.toLocaleString("en-NG", { minimumFractionDigits: 2 })}.` }, 400);

  let recipientCode = business.payout_recipient_code;
  let accountName = business.account_name || business.business_name || u.email || "SALGA Seller";
  if (!recipientCode) {
    accountName = await resolveAccount(business.bank_code, business.account_number);
    const recipient = await createRecipient({ bankCode: business.bank_code, accountNumber: business.account_number, accountName });
    recipientCode = recipient.recipient_code;
    await supabase.from("businesses").update({ account_name: accountName, payout_recipient_code: recipientCode, payout_verified_at: new Date().toISOString() }).eq("id", business.id);
    await supabase.from("seller_payout_accounts").update({ account_name: accountName, recipient_code: recipientCode, verified: true, verified_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("business_id", business.id).eq("is_default", true);
  }

  const reference = `salga-withdraw-${u.id.replace(/-/g, "").slice(0, 10)}-${Date.now()}`;
  const { data: withdrawal, error: insertError } = await supabase.from("withdrawals").insert({ requested_by: u.id, amount, type: "seller", status: "processing", reference, provider: "paystack", notes: "Manual seller withdrawal confirmed with SALGA 4-digit withdrawal PIN." }).select("*").single();
  if (insertError) throw insertError;

  const transfer = await paystack("/transfer", { method: "POST", body: JSON.stringify({ source: "balance", amount: Math.round(amount * 100), recipient: recipientCode, reference, reason: `SALGA seller withdrawal for ${business.business_name || "business"}`, currency: "NGN" }) });
  const transferData = await transfer.json().catch(() => ({}));
  if (!transfer.ok || !transferData.status) {
    await supabase.from("withdrawals").update({ status: "failed", notes: transferData.message || "Paystack transfer failed." }).eq("id", withdrawal.id);
    return json({ error: transferData.message || "The bank transfer could not be started." }, 400);
  }

  const transferStatus = transferData.data?.status || "pending";
  const finalStatus = transferStatus === "success" ? "paid" : "processing";
  await supabase.from("withdrawals").update({ status: finalStatus, provider_reference: transferData.data?.reference || reference, transfer_code: transferData.data?.transfer_code || null, processed_at: finalStatus === "paid" ? new Date().toISOString() : null }).eq("id", withdrawal.id);
  return json({ success: true, status: transferStatus, amount, message: finalStatus === "paid" ? "Your withdrawal has been sent to your registered business bank account." : "Your withdrawal has been submitted to the bank and is processing." });
}

async function adminRequest(u, body) {
  if (String(u.email || "").toLowerCase() !== ADMIN_EMAIL) return json({ error: "Admin access required." }, 403);
  const amount = Number(body.amount);
  const bankName = String(body.bank_name || "").trim();
  const bankCode = String(body.bank_code || "").trim();
  const accountNumber = String(body.account_number || "").replace(/\D/g, "");
  if (!Number.isFinite(amount) || amount <= 0) return json({ error: "Enter a valid withdrawal amount." }, 400);
  if (!bankName || !bankCode || !validAccount(accountNumber)) return json({ error: "Bank name, bank code and a 10-digit account number are required." }, 400);
  const { data: available, error: balanceError } = await supabase.rpc("admin_available_commission");
  if (balanceError) throw balanceError;
  const balance = Number(available || 0);
  if (balance < 500000) return json({ error: `Admin withdrawal is locked until accumulated commission reaches ₦500,000. Current available commission: ₦${balance.toLocaleString("en-NG", { minimumFractionDigits: 2 })}.` }, 400);
  if (amount > balance) return json({ error: "Withdrawal amount exceeds the available commission balance." }, 400);
  const accountName = await resolveAccount(bankCode, accountNumber);
  const { data: withdrawal, error } = await supabase.from("admin_withdrawals").insert({ admin_id: u.id, amount, bank_name: bankName, account_number: accountNumber, account_name: accountName, status: "otp_required", notes: "5-digit email verification required before transfer." }).select("id,amount,bank_name,account_number,account_name,status,created_at").single();
  if (error) throw error;

  const code = String(crypto.randomInt(10000, 100000));
  const { error: otpError } = await supabase.from("admin_withdrawal_otps").insert({ admin_id: u.id, withdrawal_id: withdrawal.id, email: ADMIN_EMAIL, code_hash: hash(code), expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() });
  if (otpError) throw otpError;
  try { await sendAdminOtp(ADMIN_EMAIL, code); } catch (emailError) {
    await supabase.from("admin_withdrawals").update({ status: "failed", notes: emailError.message }).eq("id", withdrawal.id);
    throw emailError;
  }
  return json({ success: true, requires_otp: true, withdrawal_id: withdrawal.id, message: `A 5-digit verification code has been sent to ${ADMIN_EMAIL}. It expires in 10 minutes.` });
}

async function adminVerify(u, body) {
  if (String(u.email || "").toLowerCase() !== ADMIN_EMAIL) return json({ error: "Admin access required." }, 403);
  const withdrawalId = String(body.withdrawal_id || "");
  const otp = String(body.otp || "");
  if (!withdrawalId || !/^\d{5}$/.test(otp)) return json({ error: "Enter the 5-digit verification code." }, 400);
  const { data: record, error } = await supabase.from("admin_withdrawal_otps").select("id,withdrawal_id,code_hash,expires_at,attempts,verified_at").eq("withdrawal_id", withdrawalId).eq("admin_id", u.id).is("verified_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!record || new Date(record.expires_at).getTime() < Date.now()) return json({ error: "The verification code has expired. Start the withdrawal again." }, 400);
  if (Number(record.attempts || 0) >= 5) return json({ error: "Too many incorrect verification attempts. Start the withdrawal again." }, 429);
  if (record.code_hash !== hash(otp)) {
    await supabase.from("admin_withdrawal_otps").update({ attempts: Number(record.attempts || 0) + 1 }).eq("id", record.id);
    return json({ error: "Incorrect verification code." }, 401);
  }
  const { data: withdrawal, error: withdrawalError } = await supabase.from("admin_withdrawals").select("*").eq("id", withdrawalId).eq("admin_id", u.id).single();
  if (withdrawalError) throw withdrawalError;
  if (withdrawal.status !== "otp_required") return json({ error: "This withdrawal is no longer awaiting verification." }, 400);

  const recipient = await createRecipient({ bankCode: String(body.bank_code || withdrawal.bank_code || ""), accountNumber: withdrawal.account_number, accountName: withdrawal.account_name });
  const reference = `salga-admin-${withdrawal.id.replace(/-/g, "").slice(0, 24)}`;
  await supabase.from("admin_withdrawal_otps").update({ verified_at: new Date().toISOString() }).eq("id", record.id);
  await supabase.from("admin_withdrawals").update({ status: "processing", reference, otp_verified_at: new Date().toISOString() }).eq("id", withdrawal.id);

  const transfer = await paystack("/transfer", { method: "POST", body: JSON.stringify({ source: "balance", amount: Math.round(Number(withdrawal.amount) * 100), recipient: recipient.recipient_code, reference, reason: "SALGA Digital Mart admin commission withdrawal", currency: "NGN" }) });
  const data = await transfer.json().catch(() => ({}));
  if (!transfer.ok || !data.status) {
    await supabase.from("admin_withdrawals").update({ status: "failed", notes: data.message || "Paystack transfer failed." }).eq("id", withdrawal.id);
    return json({ error: data.message || "The admin bank transfer could not be started." }, 400);
  }
  const status = data.data?.status === "success" ? "completed" : "processing";
  await supabase.from("admin_withdrawals").update({ status, processed_at: status === "completed" ? new Date().toISOString() : null, notes: data.data?.transfer_code || null }).eq("id", withdrawal.id);
  return json({ success: true, status: data.data?.status || "pending", amount: Number(withdrawal.amount), message: status === "completed" ? "Admin commission has been sent to the verified bank account." : "Admin commission withdrawal is processing." });
}

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Supabase server configuration is missing." }, 503);
    const u = await getUser(req);
    if (!u) return json({ error: "Login required." }, 401);
    const body = await req.json().catch(() => ({}));
    if (body.action === "seller_request") return sellerRequest(u, body);
    if (body.action === "admin_request") return adminRequest(u, body);
    if (body.action === "admin_verify") return adminVerify(u, body);
    if (body.action === "seller_set_pin") {
      if (!validPin(body.pin)) return json({ error: "Withdrawal PIN must be exactly 4 digits." }, 400);
      const { data: business, error } = await supabase.from("businesses").select("id,withdrawal_pin_hash").eq("owner_id", u.id).limit(1).maybeSingle();
      if (error) throw error;
      if (!business) return json({ error: "Business profile not found." }, 404);
      if (business.withdrawal_pin_hash && business.withdrawal_pin_hash !== pinHash(body.current_pin || "")) return json({ error: "Current withdrawal PIN is incorrect." }, 401);
      const { error: updateError } = await supabase.from("businesses").update({ withdrawal_pin_hash: pinHash(body.pin), withdrawal_pin_set_at: new Date().toISOString() }).eq("id", business.id).eq("owner_id", u.id);
      if (updateError) throw updateError;
      return json({ success: true, message: business.withdrawal_pin_hash ? "SALGA withdrawal PIN changed." : "SALGA withdrawal PIN created." });
    }
    return json({ error: "Unknown withdrawal action." }, 400);
  } catch (error) {
    console.error("SALGA WITHDRAWAL ERROR", error);
    return json({ error: error?.message || "Withdrawal operation failed." }, 500);
  }
}

export const config = { path: "/api/withdrawals" };
