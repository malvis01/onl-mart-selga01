/* SALGA Digital Mart API gateway */

function installNetlifyEnvCompatibility() {
  if (!globalThis.Netlify) {
    globalThis.Netlify = {
      env: {
        get(name) {
          return process.env[name];
        }
      }
    };
  }
}

const ALLOWED = new Set([
  "admin",
  "auth",
  "chat",
  "customer-care",
  "dashboard",
  "orders",
  "payments",
  "products",
  "seller"
]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" }
  });
}

async function loadRoute(route) {
  switch (route) {
    case "admin": return import("../netlify/functions/admin.mjs");
    case "auth": return import("../netlify/functions/auth.mjs");
    case "chat": return import("../netlify/functions/chat.mjs");
    case "customer-care": return import("../netlify/functions/customer-care.mjs");
    case "dashboard": return import("../netlify/functions/dashboard.mjs");
    case "orders": return import("../netlify/functions/orders.mjs");
    case "payments": return import("../netlify/functions/payments.mjs");
    case "products": return import("../netlify/functions/products.mjs");
    case "seller": return import("../netlify/functions/seller.mjs");
    default: return null;
  }
}

async function normalizeNetlifyResponse(result) {
  if (result instanceof Response) return result;
  if (result && typeof result === "object" && ("statusCode" in result || "body" in result)) {
    const headers = new Headers(result.headers || {});
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    let body = result.body ?? "";
    if (result.isBase64Encoded && typeof body === "string") body = Buffer.from(body, "base64").toString("utf8");
    return new Response(body, { status: result.statusCode || 200, headers });
  }
  return new Response(JSON.stringify(result ?? {}), { status: 200, headers: { "content-type": "application/json" } });
}

export default async function handler(req) {
  try {
    installNetlifyEnvCompatibility();
    const url = new URL(req.url);
    const route = url.pathname.replace(/^\/api\//, "").replace(/\/$/, "");
    if (!ALLOWED.has(route)) return json({ error: "API endpoint not found" }, 404);

    const mod = await loadRoute(route);
    if (!mod || typeof mod.default !== "function") return json({ error: "API handler unavailable" }, 500);

    // All current SALGA handlers use the standard Web Request API.
    // Passing the Request through preserves headers.get(), json(), and method.
    return await normalizeNetlifyResponse(await mod.default(req));
  } catch (error) {
    console.error("SALGA API ERROR:", error);
    return json({ error: error instanceof Error ? error.message : "Server error" }, 500);
  }
}
