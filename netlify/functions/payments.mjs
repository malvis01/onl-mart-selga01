import { createClient } from "@supabase/supabase-js";

const PAYSTACK_URL = "https://api.paystack.co";

const SUPABASE_URL =
  Netlify.env.get("SUPABASE_URL") ||
  Netlify.env.get("VITE_SUPABASE_URL");

const SUPABASE_KEY =
  Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  Netlify.env.get("VITE_SUPABASE_PUBLISHABLE_KEY");

const PAYSTACK_SECRET =
  Netlify.env.get("PAYSTACK_SECRET_KEY");

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization",
  "Access-Control-Allow-Methods":
    "POST, OPTIONS"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json"
    }
  });
}

async function getUser(req) {
  const auth = req.headers.get("authorization");

  if (!auth || !auth.startsWith("Bearer ")) {
    return null;
  }

  const token = auth.substring(7);

  const { data, error } =
    await supabase.auth.getUser(token);

  if (error || !data?.user) {
    return null;
  }

  return data.user;
}

async function paystack(path, options = {}) {
  return fetch(
    PAYSTACK_URL + path,
    {
      ...options,
      headers: {
        Authorization:
          `Bearer ${PAYSTACK_SECRET}`,
        "Content-Type":
          "application/json",
        ...(options.headers || {})
      }
    }
  );
}

export default async (req) => {

  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers
    });
  }

  if (req.method !== "POST") {
    return json(
      { error: "Method not allowed" },
      405
    );
  }

  if (!PAYSTACK_SECRET) {
    return json(
      {
        error:
          "Paystack secret key is not configured in Netlify."
      },
      503
    );
  }

  try {

    const user = await getUser(req);

    if (!user) {
      return json(
        {
          error:
            "You must be logged in before making a payment."
        },
        401
      );
    }

    const body = await req.json();

    /*
     * ----------------------------------------------------
     * VERIFY PAYMENT
     * ----------------------------------------------------
     */
    if (body.action === "verify") {

      if (!body.reference) {
        return json(
          { error: "Payment reference is required." },
          400
        );
      }

      const response =
        await paystack(
          `/transaction/verify/${encodeURIComponent(
            body.reference
          )}`
        );

      const result = await response.json();

      if (
        !response.ok ||
        !result.status ||
        result.data?.status !== "success"
      ) {
        return json(
          {
            success: false,
            status:
              result.data?.status || "failed",
            message:
              result.message ||
              "Payment has not been confirmed."
          },
          400
        );
      }

      const reference = body.reference;

      const { data: payment } =
        await supabase
          .from("payments")
          .select(
            "id, order_id, buyer_id, seller_id, amount, status"
          )
          .eq("reference", reference)
          .maybeSingle();

      if (!payment) {
        return json(
          {
            error:
              "Payment record was not found."
          },
          404
        );
      }

      /*
       * Prevent another verification from
       * creating a second transaction.
       */
      if (payment.status === "paid") {
        return json({
          success: true,
          alreadyProcessed: true,
          message: "Payment already confirmed."
        });
      }

      if (payment.buyer_id !== user.id) {
        return json(
          {
            error:
              "You are not authorized to verify this payment."
          },
          403
        );
      }

      const gross =
        Number(payment.amount);

      const commissionRate = 5;
      const commission =
        Math.round(
          gross * 0.05 * 100
        ) / 100;

      const sellerAmount =
        Math.round(
          (gross - commission) * 100
        ) / 100;

      /*
       * Mark payment successful.
       */
      const { error: paymentError } =
        await supabase
          .from("payments")
          .update({
            status: "paid"
          })
          .eq("id", payment.id);

      if (paymentError) {
        return json(
          {
            error:
              paymentError.message
          },
          500
        );
      }

      /*
       * Mark order paid.
       */
      const { error: orderError } =
        await supabase
          .from("orders")
          .update({
            payment_status: "paid",
            status: "confirmed"
          })
          .eq("id", payment.order_id);

      if (orderError) {
        return json(
          {
            error:
              orderError.message
          },
          500
        );
      }

      /*
       * Record financial transaction.
       */
      const { data: existingTransaction } =
        await supabase
          .from("transactions")
          .select("id")
          .eq(
            "order_id",
            payment.order_id
          )
          .maybeSingle();

      if (!existingTransaction) {

        const { error: transactionError } =
          await supabase
            .from("transactions")
            .insert({
              order_id:
                payment.order_id,
              buyer_id:
                payment.buyer_id,
              seller_id:
                payment.seller_id,
              gross_amount:
                gross,
              commission_rate:
                commissionRate,
              commission_amount:
                commission,
              seller_amount:
                sellerAmount,
              status:
                "completed",
              completed_at:
                new Date().toISOString()
            });

        if (transactionError) {
          return json(
            {
              error:
                transactionError.message
            },
            500
          );
        }
      }

      /*
       * Update platform wallet.
       */
      const { data: wallet } =
        await supabase
          .from("platform_wallet")
          .select(
            "id, total_gross, total_commission"
          )
          .limit(1)
          .maybeSingle();

      if (wallet) {

        await supabase
          .from("platform_wallet")
          .update({
            total_gross:
              Number(wallet.total_gross || 0) +
              gross,

            total_commission:
              Number(
                wallet.total_commission || 0
              ) + commission,

            updated_at:
              new Date().toISOString()
          })
          .eq(
            "id",
            wallet.id
          );
      }

      return json({
        success: true,
        status: "success",
        reference,
        amount: gross,
        commission,
        sellerAmount
      });
    }

    /*
     * ----------------------------------------------------
     * INITIALIZE PAYMENT
     * ----------------------------------------------------
     */

    if (!body.productId) {
      return json(
        {
          error:
            "Product ID is required."
        },
        400
      );
    }

    const quantity =
      Math.max(
        1,
        Number(body.quantity || 1)
      );

    /*
     * Get the real product.
     */
    const { data: product, error: productError } =
      await supabase
        .from("products")
        .select(`
          id,
          business_id,
          name,
          price,
          stock,
          status,
          approved
        `)
        .eq(
          "id",
          body.productId
        )
        .eq(
          "status",
          "active"
        )
        .eq(
          "approved",
          true
        )
        .single();

    if (productError || !product) {
      return json(
        {
          error:
            "Product not found or not approved."
        },
        404
      );
    }

    if (
      product.stock < quantity
    ) {
      return json(
        {
          error:
            "There is not enough stock available."
        },
        400
      );
    }

    /*
     * Get the real business owner.
     */
    const { data: business, error: businessError } =
      await supabase
        .from("businesses")
        .select(`
          id,
          owner_id,
          business_name,
          status
        `)
        .eq(
          "id",
          product.business_id
        )
        .single();

    if (businessError || !business) {
      return json(
        {
          error:
            "Business information could not be found."
        },
        404
      );
    }

    if (business.status !== "active") {
      return json(
        {
          error:
            "This business is not currently active."
        },
        400
      );
    }

    if (business.owner_id === user.id) {
      return json(
        {
          error:
            "You cannot purchase your own product."
        },
        400
      );
    }

    const unitPrice =
      Number(product.price);

    const totalAmount =
      Math.round(
        unitPrice *
        quantity *
        100
      ) / 100;

    if (
      !Number.isFinite(totalAmount) ||
      totalAmount <= 0
    ) {
      return json(
        {
          error:
            "Invalid product price."
        },
        400
      );
    }

    const reference =
      "SALGA_" +
      Date.now() +
      "_" +
      crypto
        .randomUUID()
        .replace(/-/g, "")
        .slice(0, 10);

    /*
     * Create the real Supabase order.
     */
    const { data: order, error: orderError } =
      await supabase
        .from("orders")
        .insert({
          buyer_id:
            user.id,
          business_id:
            business.id,
          total_amount:
            totalAmount,
          delivery_fee:
            Number(
              body.deliveryFee || 0
            ),
          status:
            "pending",
          payment_status:
            "pending",
          notes:
            body.notes || null
        })
        .select()
        .single();

    if (orderError) {
      return json(
        {
          error:
            orderError.message
        },
        500
      );
    }

    /*
     * Create the real order item.
     */
    const { error: itemError } =
      await supabase
        .from("order_items")
        .insert({
          order_id:
            order.id,
          product_id:
            product.id,
          quantity,
          unit_price:
            unitPrice
        });

    if (itemError) {

      await supabase
        .from("orders")
        .delete()
        .eq(
          "id",
          order.id
        );

      return json(
        {
          error:
            itemError.message
        },
        500
      );
    }

    /*
     * Create pending payment record.
     */
    const { error: paymentError } =
      await supabase
        .from("payments")
        .insert({
          order_id:
            order.id,
          buyer_id:
            user.id,
          seller_id:
            business.owner_id,
          amount:
            totalAmount,
          status:
            "pending",
          reference,
          provider:
            "paystack"
        });

    if (paymentError) {
      return json(
        {
          error:
            paymentError.message
        },
        500
      );
    }

    /*
     * Paystack amount is in kobo.
     */
    const amountKobo =
      Math.round(
        totalAmount * 100
      );

    const email =
      body.email ||
      user.email ||
      "customer@salgadigitalmart.com";

    /*
     * IMPORTANT:
     * We do NOT use a fake seller subaccount.
     * Payment is received through the platform
     * and the seller's amount is recorded after
     * successful verification.
     */
    const payload = {
      email,
      amount:
        amountKobo,
      reference,
      currency:
        "NGN",

      channels: [
        "card",
        "bank",
        "bank_transfer",
        "ussd",
        "qr",
        "payattitude"
      ],

      callback_url:
        new URL(
          req.url
        ).origin +
        "/?payment_ref=" +
        encodeURIComponent(
          reference
        ),

      metadata: {
        orderId:
          order.id,
        productId:
          product.id,
        businessId:
          business.id,
        buyerId:
          user.id,
        sellerId:
          business.owner_id,
        commissionRate:
          5
      }
    };

    const response =
      await paystack(
        "/transaction/initialize",
        {
          method:
            "POST",
          body:
            JSON.stringify(
              payload
            )
        }
      );

    const result =
      await response.json();

    if (
      !response.ok ||
      !result.status ||
      !result.data?.authorization_url
    ) {

      /*
       * Don't leave an order looking
       * like it is still payable if
       * Paystack initialization fails.
       */
      await supabase
        .from("payments")
        .update({
          status:
            "failed"
        })
        .eq(
          "reference",
          reference
        );

      await supabase
        .from("orders")
        .update({
          payment_status:
            "failed",
          status:
            "cancelled"
        })
        .eq(
          "id",
          order.id
        );

      return json(
        {
          error:
            result.message ||
            "Paystack payment initialization failed."
        },
        400
      );
    }

    return json({
      success:
        true,

      authorization_url:
        result.data.authorization_url,

      access_code:
        result.data.access_code,

      reference,

      orderId:
        order.id,

      amount:
        totalAmount,

      commissionRate:
        5,

      paymentMethods: [
        "Card",
        "Bank",
        "Bank Transfer",
        "USSD",
        "QR",
        "PayAttitude"
      ]
    });

  } catch (error) {

    console.error(
      "PAYMENT ERROR:",
      error
    );

    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Payment operation failed."
      },
      500
    );
  }
};

export const config = {
  path: "/api/payments"
};
