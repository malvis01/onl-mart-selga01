// Vercel adapter for the existing secure Paystack payment function.
// The legacy implementation uses Netlify.env during module initialization.
// Provide a compatible reader before importing it so the same code works on Vercel.
if (!globalThis.Netlify) {
  globalThis.Netlify = {
    env: {
      get(name) {
        return process.env[name];
      }
    }
  };
}

const { default: handler } = await import("../netlify/functions/payments.mjs");
export default handler;
