// Vercel adapter for SALGA orders + Buy Now flow.
// Install the small Netlify.env compatibility shim BEFORE importing the
// existing server function because it reads environment variables at load time.
if (!globalThis.Netlify) {
  globalThis.Netlify = {
    env: {
      get(name) {
        return process.env[name];
      }
    }
  };
}

const { default: handler } = await import("../netlify/functions/orders.mjs");
export default handler;
