import OpenAI from "openai";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function jsonResponse(status, data) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        ...headers,
        "Content-Type": "application/json"
      }
    }
  );
}

export default async (req) => {
  /*
   * Allow browser preflight requests.
   */
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers
    });
  }

  /*
   * Customer Care only accepts POST requests.
   */
  if (req.method !== "POST") {
    return jsonResponse(405, {
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    /*
     * Get the OpenAI API key from Netlify environment
     * variables.
     *
     * OPENAI_API_KEY is the preferred variable.
     */
    const apiKey =
      Netlify.env.get("OPENAI_API_KEY") ||
      Netlify.env.get("OPENAI_KEY");

    if (!apiKey) {
      console.error(
        "CUSTOMER CARE ERROR: OPENAI_API_KEY is not configured."
      );

      return jsonResponse(500, {
        success: false,
        error:
          "Customer Care is not configured yet. Please contact the administrator."
      });
    }

    /*
     * Read the request body safely.
     */
    let body;

    try {
      body = await req.json();
    } catch {
      return jsonResponse(400, {
        success: false,
        error: "Invalid request."
      });
    }

    const message =
      typeof body?.message === "string"
        ? body.message.trim()
        : "";

    if (!message) {
      return jsonResponse(400, {
        success: false,
        error: "Please enter a message."
      });
    }

    /*
     * Prevent unnecessarily large requests.
     */
    if (message.length > 5000) {
      return jsonResponse(400, {
        success: false,
        error:
          "Your message is too long. Please shorten it and try again."
      });
    }

    /*
     * Create the OpenAI client using the Netlify
     * environment variable explicitly.
     */
    const openai = new OpenAI({
      apiKey
    });

    /*
     * Ask the AI Customer Care assistant to answer.
     */
    const completion =
      await openai.chat.completions.create({
        model: "gpt-4o-mini",

        temperature: 0.3,

        max_tokens: 700,

        messages: [
          {
            role: "system",

            content: `
You are the official AI Customer Care assistant for SALGA Digital Mart.

SALGA Digital Mart is a Nigerian online marketplace serving businesses and customers throughout Sagbama Local Government Area, Bayelsa State, Nigeria.

Your role is CUSTOMER CARE ONLY.

Help buyers and sellers with questions about using the marketplace.

You can help with:

- Buyer accounts
- Seller/business accounts
- Business profiles
- Login problems
- Buying products
- Selling products
- Uploading products
- Product listings
- Orders
- Payments
- Promotions
- Marketplace commissions
- Account problems
- General SALGA Digital Mart questions

CURRENT MARKETPLACE RULES:

- Marketplace transaction commission: 5%
- Promotion/advertising commission: 3%

IMPORTANT CUSTOMER SAFETY RULES:

Never ask a customer for:
- Passwords
- OTP codes
- Bank PINs
- Card PINs
- Payment PINs
- Security codes
- Private authentication information

Never invent:
- Orders
- Payments
- Refunds
- Withdrawals
- Account balances
- Transaction information
- Customer personal information
- Seller personal information

You do not have direct access to a customer's private account, bank account, payment account, order status, or transaction history unless that information is explicitly supplied to you in the conversation.

Never claim that an action has been completed unless the system actually confirms it.

If the customer reports an issue that requires manual investigation, tell them that the matter needs to be escalated to the SALGA Digital Mart administration team.

Do not pretend to be a human administrator.

Be polite, friendly, helpful and concise.

Use simple language that is easy for Nigerian buyers and sellers to understand.

If the customer asks something unrelated to SALGA Digital Mart, politely explain that you are the SALGA Digital Mart Customer Care assistant and can help with marketplace-related questions.

If the customer says hello or starts a conversation, greet them naturally and ask how you can help.

If a customer reports that something is not working, first give simple troubleshooting steps. If the problem cannot be solved from the available information, explain that it should be escalated to the administration team.
`
          },

          {
            role: "user",
            content: message
          }
        ]
      });

    const reply =
      completion?.choices?.[0]?.message?.content
        ?.trim();

    if (!reply) {
      console.error(
        "CUSTOMER CARE ERROR: OpenAI returned no response."
      );

      return jsonResponse(500, {
        success: false,
        error:
          "Customer Care could not generate a response. Please try again."
      });
    }

    /*
     * Successful Customer Care response.
     */
    return jsonResponse(200, {
      success: true,
      reply
    });

  } catch (error) {
    console.error(
      "CUSTOMER CARE ERROR:",
      error?.message || error
    );

    /*
     * Give the frontend a clean JSON response rather
     * than allowing the request to fail silently.
     */
    return jsonResponse(500, {
      success: false,
      error:
        "Customer Care is temporarily unavailable. Please try again shortly."
    });
  }
};

export const config = {
  path: "/api/customer-care",
  method: "POST"
};
