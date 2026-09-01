/*
 * SALGA Digital Mart - Vercel compatibility gateway
 *
 * Keeps the existing Netlify function code intact while exposing the
 * same /api/* endpoints through Vercel serverless functions.
 */

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

async function normalizeNetlifyResponse(result) {
  if (result instanceof Response) return result;

  if (result && typeof result === "object" && ("statusCode" in result || "body" in result)) {
    const headers = new Headers(result.headers || {});
    if (!headers.has("content-type")) headers.set("content-type", "application/json");

    let body = result.body ?? "";
    if (result.isBase64Encoded && typeof body === "string") {
      body = Buffer.from(body, "base64").toString("utf8");
    }

    return new Response(body, {
      status: result.statusCode || 200,
      headers
    });
  }

  return new Response(JSON.stringify(result ?? {}), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

export default async function handler(req) {
  try {
    installNetlifyEnvCompatibility();

    const url = new URL(req.url);
    const route = url.pathname.replace(/^\/api\//, "").replace(/\/$/, "");

    if (!ALLOWED.has(route)) {
      return json({ error: "API endpoint not found" }, 404);
    }

    const mod = await import(`../netlify/functions/${route}.mjs`);

    // The AI chat function uses the Netlify event shape. Convert the
    // incoming Vercel Request to that shape without changing its logic.
    if (route === "chat") {
      const rawBody = await req.text();
      const event = {
        httpMethod: req.method,
        headers: Object.fromEntries(req.headers.entries()),
        body: rawBody,
        isBase64Encoded: false,
        queryStringParameters: Object.fromEntries(url.searchParams.entries())
      };

      return await normalizeNetlifyResponse(await mod.default(event));
    }

    return await normalizeNetlifyResponse(await mod.default(req));
  } catch (error) {
    console.error("SALGA VERCEL API ERROR:", error);
    return json(
      {
        error: error instanceof Error ? error.message : "Server error"
      },
      500
    );
  }
}
