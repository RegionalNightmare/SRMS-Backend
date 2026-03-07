// routes/menuRoutes.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const pool = require("../config/db");
const { protect, adminOnly } = require("../middleware/authMiddleware");

const router = express.Router();

/* ---------- Multer config ---------- */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dest = path.join(__dirname, "..", "uploads", "menu");
    fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path
      .basename(file.originalname, ext)
      .replace(/\s+/g, "-")
      .toLowerCase();
    cb(null, `${base}-${Date.now()}${ext}`);
  },
});

const upload = multer({ storage });

/* ---------- Public: get menu ---------- */
// GET /api/menu
router.get("/", async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      "SELECT id, name, category, description, price, available, image_url FROM menu_items WHERE available = 1 ORDER BY category, name"
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});


/* ---------- Admin: create menu item with optional image ---------- */
// POST /api/menu
router.post(
  "/",
  protect,
  adminOnly,
  upload.single("image"),
  async (req, res, next) => {
    try {
      const { name, category, price, description, dietary_tags, available } = req.body;

      if (!name || !category || !price) {
        return res
          .status(400)
          .json({ message: "name, category, and price are required" });
      }

      const imageUrl = req.file
        ? `/uploads/menu/${req.file.filename}`
        : null;

      const [result] = await pool.execute(
  `INSERT INTO menu_items
   (name, category, description, price, available, dietary_tags, image_url)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
  [
    name,
    category,
    description || null,
    price,
    available == 0 ? 0 : 1,
    dietary_tags || null,
    imageUrl
  ]
);

      res.status(201).json({
  id: result.insertId,
  name,
  category,
  description,
  price,
  available: available == 0 ? 0 : 1,
  dietary_tags: dietary_tags || null,
  image_url: imageUrl,
});
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PUT /api/menu/:id (admin)
 */
router.put("/:id", protect, adminOnly, async (req, res, next) => {
  try {
    const { id } = req.params;

    const [existingRows] = await pool.execute(
      "SELECT * FROM menu_items WHERE id = ?",
      [id]
    );
    if (existingRows.length === 0) {
      return res.status(404).json({ message: "Menu item not found" });
    }

    const existing = existingRows[0];

    const {
      name = existing.name,
      category = existing.category,
      description = existing.description,
      ingredients,
      price = existing.price,
      available = existing.available,
      dietaryTags,
    } = req.body;

    await pool.execute(
      `UPDATE menu_items
       SET name = ?, category = ?, description = ?, ingredients = ?, price = ?, available = ?, dietary_tags = ?
       WHERE id = ?`,
      [
        name,
        category,
        description,
        ingredients
          ? ingredients.join
            ? ingredients.join(",")
            : ingredients
          : existing.ingredients,
        price,
        available,
        dietaryTags
          ? dietaryTags.join
            ? dietaryTags.join(",")
            : dietaryTags
          : existing.dietary_tags,
        id,
      ]
    );

    const [updatedRows] = await pool.execute(
      "SELECT * FROM menu_items WHERE id = ?",
      [id]
    );

    res.json(updatedRows[0]);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/menu/:id (admin)
 */
router.delete("/:id", protect, adminOnly, async (req, res, next) => {
  try {
    const { id } = req.params;

    await pool.execute("DELETE FROM menu_items WHERE id = ?", [id]);
    res.json({ message: "Menu item deleted" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
