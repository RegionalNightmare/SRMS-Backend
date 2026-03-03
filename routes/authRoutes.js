const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const pool = require("../config/db");

const router = express.Router();

const generateToken = (id, role) =>
  jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: "7d" });

/**
 * POST /api/auth/register
 */
router.post("/register", async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body;

    // basic validation
    if (!name || !email || !password) {
      return res
        .status(400)
        .json({ message: "Name, email and password are required" });
    }

    const [existing] = await pool.execute(
      "SELECT id FROM users WHERE email = ?",
      [email]
    );
    if (existing.length > 0) {
      return res.status(400).json({ message: "User already exists" });
    }

    const hashed = await bcrypt.hash(password, 10);

    const [result] = await pool.execute(
      "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)",
      [name, email, hashed, role || "customer"]
    );

    const newUserId = result.insertId;

    res.status(201).json({
      id: newUserId,
      name,
      email,
      role: role || "customer",
      token: generateToken(newUserId, role || "customer"),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/login
 */
router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required" });
    }

    const [rows] = await pool.execute(
      "SELECT id, name, email, role, password_hash FROM users WHERE email = ?",
      [email]
    );

    if (rows.length === 0) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const user = rows[0];
    console.log("Login user row:", user); // DEBUG

    if (!user.password_hash) {
      console.error("User is missing password_hash");
      return res
        .status(500)
        .json({ message: "User record is missing a password hash" });
    }

    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      token: generateToken(user.id, user.role),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/forgot-password
 */
router.post("/forgot-password", async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const [rows] = await pool.execute(
      "SELECT id FROM users WHERE email = ?",
      [email]
    );

    // Always return success message (prevents email enumeration)
    if (rows.length === 0) {
      return res.json({
        message: "If an account exists, a reset link has been generated.",
      });
    }

    const userId = rows[0].id;

    // Create secure random token
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await pool.execute(
      "UPDATE users SET reset_token_hash = ?, reset_token_expires = ? WHERE id = ?",
      [tokenHash, expires, userId]
    );

    const frontendUrl = process.env.FRONTEND_URL;

if (!frontendUrl) {
  throw new Error("FRONTEND_URL is not defined in environment variables");
}

const resetLink = `${frontendUrl}/reset-password?token=${token}&email=${encodeURIComponent(email)}`;

    console.log("PASSWORD RESET LINK:", resetLink);

    res.json({
      message: "If an account exists, a reset link has been generated.",
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/reset-password
 */
router.post("/reset-password", async (req, res, next) => {
  try {
    const { email, token, newPassword } = req.body;

    if (!email || !token || !newPassword) {
      return res
        .status(400)
        .json({ message: "Email, token, and new password are required" });
    }

    if (newPassword.length < 6) {
      return res
        .status(400)
        .json({ message: "Password must be at least 6 characters" });
    }

    const tokenHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    const [rows] = await pool.execute(
      "SELECT id, reset_token_hash, reset_token_expires FROM users WHERE email = ?",
      [email]
    );

    if (rows.length === 0) {
      return res.status(400).json({ message: "Invalid reset token" });
    }

    const user = rows[0];

    if (
      !user.reset_token_hash ||
      user.reset_token_hash !== tokenHash ||
      new Date(user.reset_token_expires) < new Date()
    ) {
      return res.status(400).json({ message: "Invalid or expired reset token" });
    }

    const hashed = await bcrypt.hash(newPassword, 10);

    await pool.execute(
      "UPDATE users SET password_hash = ?, reset_token_hash = NULL, reset_token_expires = NULL WHERE id = ?",
      [hashed, user.id]
    );

    res.json({ message: "Password successfully reset" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
