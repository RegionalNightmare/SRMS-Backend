const express = require("express");
const pool = require("../config/db");
const { protect, adminOnly } = require("../middleware/authMiddleware");

const router = express.Router();

/**
 * Helper: fetch menu items by IDs and compute total price
 */
async function calculateTotalAndValidateItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Order must contain at least one item");
  }

  const ids = items.map((it) => it.menuItemId);
  const placeholders = ids.map(() => "?").join(",");

  const [rows] = await pool.execute(
    `SELECT id, price, available FROM menu_items WHERE id IN (${placeholders})`,
    ids
  );

  if (rows.length !== ids.length) {
    throw new Error("One or more menu items do not exist");
  }

  const priceMap = new Map();
  for (const row of rows) {
    if (!row.available) {
      throw new Error(`Menu item with ID ${row.id} is not available`);
    }
    priceMap.set(row.id, Number(row.price));
  }

  let total = 0;
  for (const it of items) {
    const price = priceMap.get(it.menuItemId);
    const qty = Number(it.quantity) || 1;
    total += price * qty;
  }

  return { total, priceMap };
}
/**
 * POST /api/orders
 * Create a new order for the logged-in user
 * Body:
 * {
 *   "items": [{ "menuItemId": 1, "quantity": 2 }, ...],
 *   "type": "pickup" | "delivery",
 *   "deliveryAddress": "optional if pickup"
 * }
 */
router.post("/", protect, async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const { items, type, deliveryAddress } = req.body;

    if (!type || !["pickup", "delivery"].includes(type)) {
      return res.status(400).json({ message: "Invalid order type" });
    }

    if (type === "delivery" && !deliveryAddress) {
      return res.status(400).json({ message: "Delivery address required" });
    }

   const { total: totalPrice, priceMap } = await calculateTotalAndValidateItems(items);

    // Start transaction
    await connection.beginTransaction();

    // Insert into orders
    const [orderResult] = await connection.execute(
      `INSERT INTO orders (user_id, total_price, status, type, delivery_address)
       VALUES (?, ?, 'pending', ?, ?)`,
      [req.user.id, totalPrice, type, deliveryAddress || null]
    );

    const orderId = orderResult.insertId;

    // Insert order_items
    for (const it of items) {
  const qty = Number(it.quantity) || 1;
  const priceEach = priceMap.get(it.menuItemId);

  await connection.execute(
    `INSERT INTO order_items (order_id, menu_item_id, quantity, price_each)
     VALUES (?, ?, ?, ?)`,
    [orderId, it.menuItemId, qty, priceEach]
  );
}

const merged = new Map();
for (const it of items) {
  const id = it.menuItemId;
  const qty = Number(it.quantity) || 1;
  merged.set(id, (merged.get(id) || 0) + qty);
}
const normalizedItems = [...merged.entries()].map(([menuItemId, quantity]) => ({ menuItemId, quantity }));

    await connection.commit();

    res.status(201).json({
      message: "Order created",
      orderId,
      totalPrice,
    });
  } catch (err) {
    await connection.rollback();
    next(err);
  } finally {
    connection.release();
  }
});

/**
 * GET /api/orders/my
 * Get orders for current user (with items)
 */
router.get("/my", protect, async (req, res, next) => {
  try {
    const [orders] = await pool.execute(
      `SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC`,
      [req.user.id]
    );

    if (orders.length === 0) {
      return res.json([]);
    }

    const orderIds = orders.map((o) => o.id);
    const placeholders = orderIds.map(() => "?").join(",");

    const [items] = await pool.execute(
      `SELECT oi.*, mi.name AS menu_item_name, mi.price AS menu_item_price
       FROM order_items oi
       JOIN menu_items mi ON oi.menu_item_id = mi.id
       WHERE oi.order_id IN (${placeholders})`,
      orderIds
    );

    // Attach items to orders
    const itemsByOrder = {};
    items.forEach((row) => {
      if (!itemsByOrder[row.order_id]) itemsByOrder[row.order_id] = [];
      itemsByOrder[row.order_id].push({
        id: row.id,
        menuItemId: row.menu_item_id,
        name: row.menu_item_name,
        price: Number(row.menu_item_price),
        quantity: row.quantity,
      });
    });

    const result = orders.map((o) => ({
      ...o,
      total_price: Number(o.total_price),
      items: itemsByOrder[o.id] || [],
    }));

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/orders (admin only)
 * Optional query: ?status=pending
 */
router.get("/", protect, adminOnly, async (req, res, next) => {
  try {
    const { status } = req.query;
    let sql = "SELECT * FROM orders WHERE 1=1";
    const params = [];

    if (status) {
      sql += " AND status = ?";
      params.push(status);
    }

    sql += " ORDER BY created_at DESC";

    const [orders] = await pool.execute(sql, params);
    res.json(orders);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/orders/:id/status (admin)
 * Body: { "status": "preparing" | "ready" | "delivered" | "cancelled" }
 */
router.put("/:id/status", protect, adminOnly, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const allowed = ["pending", "preparing", "ready", "delivered", "cancelled"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const [existing] = await pool.execute(
      "SELECT * FROM orders WHERE id = ?",
      [id]
    );
    if (existing.length === 0) {
      return res.status(404).json({ message: "Order not found" });
    }

    await pool.execute(
      "UPDATE orders SET status = ? WHERE id = ?",
      [status, id]
    );

    res.json({ message: "Order status updated" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
