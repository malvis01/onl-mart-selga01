import OpenAI from "openai";

export default async (req) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: {
          ...headers,
          "Content-Type": "application/json"
        }
      }
    );
  }

  try {
    const body = await req.json();

    const message = String(body.message || "").trim();

    if (!message) {
      return new Response(
        JSON.stringify({
          error: "Please enter a message."
        }),
        {
          status: 400,
          headers: {
            ...headers,
            "Content-Type": "application/json"
          }
        }
      );
    }

    const openai = new OpenAI();

    const completion =
      await openai.chat.completions.create({
        model: "gpt-4o-mini",

        messages: [
          {
            role: "system",
            content: `
You are the official AI Customer Care assistant for SALGA Digital Mart, a Nigerian online marketplace serving businesses and customers in Sagbama LGA, Bayelsa State.

Your job is to help BUYERS and SELLERS.

You can help with:
- Creating buyer accounts
- Creating seller/business accounts
- Logging in
- Buying products
- Selling products
- Uploading products
- Product approval
- Orders
- Payments
- Promotions
- Marketplace commissions
- Account problems
- General questions about SALGA Digital Mart

Marketplace commission is 5% of completed transactions.

Promotion commission is 3%.

Be polite, friendly, clear and concise.

Never claim that a payment, refund, order, account change or withdrawal has been completed unless the system actually confirms it.

Never ask customers for their password, PIN, OTP, bank PIN or other secret authentication information.

If a customer has a problem that requires an administrator to manually investigate, explain that the issue needs to be escalated to the SALGA Digital Mart administration team.

Do not invent transaction information or pretend that you can see private account information that has not been provided to you.
`
          },
          {
            role: "user",
            content: message
          }
        ]
      });

    const reply =
      completion.choices?.[0]?.message?.content ||
      "Sorry, I couldn't process your message right now. Please try again.";

    return new Response(
      JSON.stringify({
        success: true,
        reply
      }),
      {
        status: 200,
        headers: {
          ...headers,
          "Content-Type": "application/json"
        }
      }
    );

  } catch (error) {

    console.error(
      "CUSTOMER CARE ERROR:",
      error
    );

    return new Response(
      JSON.stringify({
        error:
          "Customer Care is temporarily unavailable. Please try again shortly."
      }),
      {
        status: 500,
        headers: {
          ...headers,
          "Content-Type": "application/json"
        }
      }
    );
  }
};

export const config = {
  path: "/api/customer-care",
  method: "POST"
};
