import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  Netlify.env.get("SUPABASE_URL") ||
  Netlify.env.get("VITE_SUPABASE_URL");

const SUPABASE_KEY =
  Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  Netlify.env.get("VITE_SUPABASE_PUBLISHABLE_KEY");

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error("Supabase environment variables are missing");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, apikey, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers
  });
}

async function getUser(req) {
  const authorization = req.headers.get("authorization");

  if (!authorization || !authorization.startsWith("Bearer ")) {
    return null;
  }

  const token = authorization.substring(7);

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data?.user) {
    return null;
  }

  return data.user;
}

async function getProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, role, phone, full_name")
    .eq("id", userId)
    .single();

  if (error || !data) {
    return {
      profile: null,
      error
    };
  }

  return {
    profile: data,
    error: null
  };
}

/*
 * GET
 *
 * Loads orders for the logged-in buyer or seller.
 */
async function getOrders(req) {
  const user = await getUser(req);

  if (!user) {
    return json(
      { error: "Login required" },
      401
    );
  }

  const { profile, error: profileError } =
    await getProfile(user.id);

  if (profileError || !profile) {
    return json(
      { error: "User profile not found" },
      404
    );
  }

  /*
   * BUYER
   */
  if (profile.role === "buyer") {
    const { data: orders, error } =
      await supabase
        .from("orders")
        .select(`
          id,
          buyer_id,
          business_id,
          total_amount,
          delivery_fee,
          status,
          payment_status,
          notes,
          created_at,
          updated_at,
          businesses (
            id,
            business_name,
            logo_url
          ),
          order_items (
            id,
            product_id,
            quantity,
            unit_price,
            products (
              id,
              name,
              image_url
            )
          )
        `)
        .eq("buyer_id", user.id)
        .order("created_at", {
          ascending: false
        });

    if (error) {
      console.error("BUYER ORDERS ERROR:", error);

      return json(
        { error: error.message },
        500
      );
    }

    return json({
      orders: orders || []
    });
  }

  /*
   * SELLER
   */
  if (
    profile.role === "seller" ||
    profile.role === "business_owner"
  ) {
    const { data: businesses, error: businessError } =
      await supabase
        .from("businesses")
        .select("id")
        .eq("owner_id", user.id);

    if (businessError) {
      console.error(
        "SELLER BUSINESS ERROR:",
        businessError
      );

      return json(
        { error: businessError.message },
        500
      );
    }

    const businessIds =
      (businesses || []).map(
        business => business.id
      );

    if (!businessIds.length) {
      return json({
        orders: []
      });
    }

    const { data: orders, error } =
      await supabase
        .from("orders")
        .select(`
          id,
          buyer_id,
          business_id,
          total_amount,
          delivery_fee,
          status,
          payment_status,
          notes,
          created_at,
          updated_at,
          businesses (
            id,
            business_name,
            logo_url
          ),
          order_items (
            id,
            product_id,
            quantity,
            unit_price,
            products (
              id,
              name,
              image_url
            )
          )
        `)
        .in("business_id", businessIds)
        .order("created_at", {
          ascending: false
        });

    if (error) {
      console.error("SELLER ORDERS ERROR:", error);

      return json(
        { error: error.message },
        500
      );
    }

    return json({
      orders: orders || []
    });
  }

  return json(
    { error: "Unsupported account role" },
    403
  );
}

/*
 * POST
 *
 * Creates an order and its order_items.
 *
 * This is included so a POST request to /api/orders
 * does NOT immediately return "Method not allowed".
 *
 * Expected body:
 *
 * {
 *   productId: "...",
 *   quantity: 1,
 *   deliveryFee: 0,
 *   notes: "..."
 * }
 */
async function createOrder(req) {
  const user = await getUser(req);

  if (!user) {
    return json(
      { error: "Login required" },
      401
    );
  }

  let body;

  try {
    body = await req.json();
  } catch {
    return json(
      { error: "Invalid JSON request body" },
      400
    );
  }

  const productId =
    body?.productId ||
    body?.product_id;

  const quantity = Number(
    body?.quantity || 1
  );

  const deliveryFee = Number(
    body?.deliveryFee ||
    body?.delivery_fee ||
    0
  );

  const notes =
    body?.notes ||
    null;

  if (!productId) {
    return json(
      { error: "productId is required" },
      400
    );
  }

  if (
    !Number.isFinite(quantity) ||
    quantity < 1
  ) {
    return json(
      { error: "Invalid quantity" },
      400
    );
  }

  /*
   * Get the product.
   */
  const { data: product, error: productError } =
    await supabase
      .from("products")
      .select(`
        id,
        name,
        price,
        business_id
      `)
      .eq("id", productId)
      .single();

  if (productError || !product) {
    console.error(
      "PRODUCT LOOKUP ERROR:",
      productError
    );

    return json(
      {
        error:
          productError?.message ||
          "Product not found"
      },
      404
    );
  }

  const unitPrice = Number(product.price);

  if (
    !Number.isFinite(unitPrice) ||
    unitPrice < 0
  ) {
    return json(
      { error: "Invalid product price" },
      400
    );
  }

  const productTotal =
    unitPrice * quantity;

  const totalAmount =
    productTotal + deliveryFee;

  /*
   * Create order.
   */
  const { data: order, error: orderError } =
    await supabase
      .from("orders")
      .insert({
        buyer_id: user.id,
        business_id: product.business_id,
        total_amount: totalAmount,
        delivery_fee: deliveryFee,
        status: "pending",
        payment_status: "pending",
        notes
      })
      .select(`
        id,
        buyer_id,
        business_id,
        total_amount,
        delivery_fee,
        status,
        payment_status,
        notes,
        created_at,
        updated_at
      `)
      .single();

  if (orderError || !order) {
    console.error(
      "ORDER CREATE ERROR:",
      orderError
    );

    return json(
      {
        error:
          orderError?.message ||
          "Unable to create order"
      },
      500
    );
  }

  /*
   * Create order item.
   */
  const { data: orderItem, error: itemError } =
    await supabase
      .from("order_items")
      .insert({
        order_id: order.id,
        product_id: product.id,
        quantity,
        unit_price: unitPrice
      })
      .select(`
        id,
        order_id,
        product_id,
        quantity,
        unit_price
      `)
      .single();

  if (itemError || !orderItem) {
    console.error(
      "ORDER ITEM CREATE ERROR:",
      itemError
    );

    /*
     * Remove the order if its item could not
     * be created, preventing an incomplete order.
     */
    await supabase
      .from("orders")
      .delete()
      .eq("id", order.id);

    return json(
      {
        error:
          itemError?.message ||
          "Unable to create order item"
      },
      500
    );
  }

  return json(
    {
      success: true,
      order,
      order_item: orderItem
    },
    201
  );
}

export default async (req) => {
  try {
    /*
     * CORS preflight.
     */
    if (req.method === "OPTIONS") {
      return new Response("ok", {
        status: 200,
        headers
      });
    }

    /*
     * GET = load orders.
     */
    if (req.method === "GET") {
      return await getOrders(req);
    }

    /*
     * POST = create order.
     */
    if (req.method === "POST") {
      return await createOrder(req);
    }

    /*
     * Other methods.
     */
    return json(
      {
        error: "Method not allowed",
        allowed_methods: [
          "GET",
          "POST",
          "OPTIONS"
        ]
      },
      405
    );

  } catch (error) {
    console.error(
      "ORDERS FUNCTION ERROR:",
      error
    );

    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to process order"
      },
      500
    );
  }
};

export const config = {
  path: "/api/orders"
};
