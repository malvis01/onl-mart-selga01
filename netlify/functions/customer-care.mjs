import OpenAI from "openai";

export default async (req) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };

  // Handle browser CORS request
  if (req.method === "OPTIONS") {
    return new Response("OK", {
      status: 200,
      headers
    });
  }

  // Only POST is allowed
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({
        success: false,
        error: "Method not allowed"
      }),
      {
        status: 405,
        headers
      }
    );
  }

  try {
    // Get API key from Netlify environment
    const apiKey = Netlify.env.get("OPENAI_API_KEY");

    if (!apiKey) {
      console.error("OPENAI_API_KEY is missing");

      return new Response(
        JSON.stringify({
          success: false,
          error: "Customer Care is not configured correctly."
        }),
        {
          status: 500,
          headers
        }
      );
    }

    // Read request body safely
    let body;

    try {
      body = await req.json();
    } catch (e) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Invalid request."
        }),
        {
          status: 400,
          headers
        }
      );
    }

    const message = String(body?.message || "").trim();

    if (!message) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Please enter a message."
        }),
        {
          status: 400,
          headers
        }
      );
    }

    const openai = new OpenAI({
      apiKey
    });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
You are the official AI Customer Care assistant for SALGA Digital Mart.

SALGA Digital Mart is an online marketplace serving businesses and customers throughout Sagbama LGA, Bayelsa State, Nigeria.

Help buyers and sellers with:
- Buyer accounts
- Seller/business accounts
- Login problems
- Buying products
- Selling products
- Product uploads
- Orders
- Payments
- Promotions
- Marketplace commissions
- Account problems
- General SALGA Digital Mart questions

Marketplace commission is 5% of completed transactions.

Promotion commission is 3%.

Be friendly, professional and concise.

Never ask for passwords, OTPs, PINs, bank PINs or other secret authentication information.

Never claim that a payment, refund, order, withdrawal or account change has been completed unless the system has actually confirmed it.

If an issue requires an administrator to investigate, explain that it needs to be escalated to the SALGA Digital Mart administration team.

Do not invent account, order, payment or transaction information.
`
        },
        {
          role: "user",
          content: message
        }
      ]
    });

    const reply =
      completion?.choices?.[0]?.message?.content?.trim() ||
      "Sorry, I couldn't process your message right now. Please try again.";

    return new Response(
      JSON.stringify({
        success: true,
        reply
      }),
      {
        status: 200,
        headers
      }
    );

  } catch (error) {
    console.error("CUSTOMER CARE ERROR:", error);

    return new Response(
      JSON.stringify({
        success: false,
        error: "Customer Care is temporarily unavailable. Please try again shortly."
      }),
      {
        status: 500,
        headers
      }
    );
  }
};

export const config = {
  path: "/api/customer-care"
};
