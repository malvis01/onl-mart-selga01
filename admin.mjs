import { read, json, body, hash } from "./_shared/store.mjs";

const ADMIN_EMAIL = () =>
  Netlify.env.get("ADMIN_EMAIL") || "admin@salgadigitalmart.com";

const ADMIN_PASS = () =>
  Netlify.env.get("ADMIN_PASSWORD") || "CHANGE_THIS_ADMIN_PASSWORD";

function token() {
  return "admin_" + hash(ADMIN_EMAIL() + ADMIN_PASS());
}

function authorized(req) {
  return req.headers.get("Authorization") === `Bearer ${token()}`;
}

async function dashboard() {
  const users = await read("users", []);
  const orders = await read("orders", []);
  const promotions = await read("promotions", []);
  const withdrawals = await read("withdrawals", []);

  const paidOrders = orders.filter(x => x.status === "paid");
  const businesses = users.filter(
    x => x.role === "seller" || x.role === "business"
  );
  const buyers = users.filter(x => x.role === "buyer");

  const transactionVolume = paidOrders.reduce(
    (sum, order) => sum + Number(order.amount || order.total || 0),
    0
  );

  const marketplaceCommission = paidOrders.reduce(
    (sum, order) => sum + Number(order.commission || 0),
    0
  );

  const promotionCommission = paidOrders.reduce(
    (sum, order) => sum + Number(order.promotionFee || 0),
    0
  );

  const productCount = users.reduce(
    (sum, user) => sum + Number(user.productCount || 0),
    0
  );

  return {
    stats: {
      users: users.length,
      buyers: buyers.length,
      sellers: businesses.length,
      businesses: businesses.length,
      orders: orders.length,
      products: productCount,
      revenue: transactionVolume,
      transaction_volume: transactionVolume,
      marketplace_commission: marketplaceCommission,
      promotion_commission: promotionCommission,
      commissions: marketplaceCommission,
      promotionFees: promotionCommission
    },
    users: users.map(user => ({
      id: user.id,
      name: user.name || user.full_name || "",
      phone: user.phone || "",
      email: user.email || "",
      role: user.role || "",
      businessName: user.businessName || user.business_name || "",
      status: user.status || "active"
    })),
    businesses: businesses.map(user => ({
      id: user.id,
      name: user.businessName || user.business_name || user.name || "Business",
      businessName: user.businessName || user.business_name || user.name || "Business",
      phone: user.phone || "",
      email: user.email || "",
      status: user.status || "active"
    })),
    orders,
    transactions: paidOrders,
    commissions: paidOrders.map(order => ({
      orderId: order.id,
      amount: Number(order.commission || 0),
      status: order.status || "paid"
    })),
    promotions,
    withdrawals,
    conversations: []
  };
}

export default async req => {
  if (req.method === "POST") {
    const request = await body(req);

    if (request.action === "login") {
      if (
        request.email !== ADMIN_EMAIL() ||
        request.password !== ADMIN_PASS()
      ) {
        return json({ error: "Invalid admin credentials" }, 401);
      }

      return json({
        token: token(),
        message: "Admin login successful."
      });
    }

    if (request.action === "dashboard") {
      if (!authorized(req)) {
        return json({ error: "Unauthorized" }, 401);
      }

      return json(await dashboard());
    }

    return json({ error: "Invalid admin action" }, 400);
  }

  if (req.method === "GET") {
    if (!authorized(req)) {
      return json({ error: "Unauthorized" }, 401);
    }

    return json(await dashboard());
  }

  return json({ error: "Method not allowed" }, 405);
};

export const config = { path: "/api/admin" };
