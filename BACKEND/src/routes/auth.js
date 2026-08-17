const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const db = require("../db/database");
const { requireAuth } = require("../middleware/auth");
const { sendPasswordResetEmail } = require("../utils/mailer");

const router = express.Router();
const SALT_ROUNDS = 10;
const RESET_TOKEN_TTL_MINUTES = 15; // ลิงก์รีเซ็ตรหัสผ่านหมดอายุใน 15 นาที

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------- อัปโหลดรูปโปรไฟล์ ----------
const avatarUploadRoot = path.join(__dirname, "..", "..", "uploads", "avatars");
fs.mkdirSync(avatarUploadRoot, { recursive: true });
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, avatarUploadRoot),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || "").replace(/[^a-zA-Z0-9.]/g, "");
    cb(null, `${req.user.id}-${Date.now()}${ext}`);
  },
});
const AVATAR_ALLOWED_MIME = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => cb(null, AVATAR_ALLOWED_MIME.includes(file.mimetype)),
});

// เข้ารหัส token ด้วย sha256 ก่อนเก็บลงฐานข้อมูล (ไม่เก็บ token ดิบไว้ในฐานข้อมูล)
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// ---------- POST /api/auth/register ----------
router.post("/register", async (req, res) => {
  try {
    const { email, username, password, confirmPassword } = req.body;

    // ---- validate ข้อมูลที่ส่งมา ----
    if (!email || !username || !password || !confirmPassword) {
      return res.status(400).json({ message: "กรุณากรอกข้อมูลให้ครบทุกช่อง" });
    }
    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ message: "รูปแบบอีเมลไม่ถูกต้อง" });
    }
    if (username.trim().length < 3) {
      return res.status(400).json({ message: "Username ต้องมีอย่างน้อย 3 ตัวอักษร" });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร" });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ message: "รหัสผ่านไม่ตรงกัน" });
    }

    // ---- เช็คว่า email หรือ username ซ้ำหรือไม่ ----
    const existing = db
      .prepare("SELECT id FROM users WHERE email = ? OR username = ?")
      .get(email, username);

    if (existing) {
      return res.status(409).json({ message: "อีเมลหรือ Username นี้ถูกใช้ไปแล้ว" });
    }

    // ---- เข้ารหัส password แล้วบันทึกลงฐานข้อมูล ----
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const result = db
      .prepare("INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)")
      .run(email, username, passwordHash);

    return res.status(201).json({
      message: "สมัครสมาชิกสำเร็จ",
      user: { id: result.lastInsertRowid, email, username },
    });
  } catch (err) {
    console.error("Register error:", err);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์" });
  }
});

// ---------- POST /api/auth/login ----------
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "กรุณากรอกอีเมลและรหัสผ่าน" });
    }

    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);

    // ไม่บอกตรงๆ ว่า "ไม่พบอีเมล" เพื่อป้องกันการเดาว่าอีเมลไหนมีอยู่ในระบบ
    if (!user) {
      return res.status(401).json({ message: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ message: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });
    }

    // ---- ออก JWT token (ใส่ isAdmin ไปด้วยเพื่อให้ requireAdmin middleware เช็คได้โดยไม่ต้อง query DB ซ้ำ) ----
    const isAdmin = !!user.is_admin;
    const token = jwt.sign(
      { id: user.id, email: user.email, username: user.username, isAdmin },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
    );

    return res.json({
      message: "เข้าสู่ระบบสำเร็จ",
      token,
      user: { id: user.id, email: user.email, username: user.username, isAdmin },
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์" });
  }
});

// ---------- GET /api/auth/me (route ตัวอย่างที่ต้อง login ก่อน) ----------
router.get("/me", requireAuth, (req, res) => {
  // req.user มาจาก middleware requireAuth (ถอดรหัสจาก token แล้ว)
  const user = db
    .prepare("SELECT id, email, username, coins, is_admin, avatar_url, created_at FROM users WHERE id = ?")
    .get(req.user.id);

  if (!user) {
    return res.status(404).json({ message: "ไม่พบผู้ใช้งาน" });
  }

  return res.json({ user: { ...user, avatarUrl: user.avatar_url } });
});

// ---------- POST /api/auth/avatar ----------
// อัปโหลดรูปโปรไฟล์ใหม่ บันทึก URL ลง users.avatar_url ถาวร (ไม่หายตอนออกจากระบบ เพราะอยู่ในฐานข้อมูล ไม่ใช่ localStorage)
router.post("/avatar", requireAuth, avatarUpload.single("avatar"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "อัปโหลดรูปไม่สำเร็จ (ชนิดไฟล์ไม่รองรับ หรือไฟล์ใหญ่เกิน 5MB)" });
  }

  const avatarUrl = `/uploads/avatars/${req.file.filename}`;
  db.prepare("UPDATE users SET avatar_url = ? WHERE id = ?").run(avatarUrl, req.user.id);

  return res.json({ message: "อัปเดตรูปโปรไฟล์สำเร็จ", avatarUrl });
});

// ---------- PUT /api/auth/username ----------
router.put("/username", requireAuth, (req, res) => {
  const { username } = req.body;
  if (!username || username.trim().length < 3) {
    return res.status(400).json({ message: "Username ต้องมีอย่างน้อย 3 ตัวอักษร" });
  }

  const trimmed = username.trim();
  const existing = db.prepare("SELECT id FROM users WHERE username = ? AND id != ?").get(trimmed, req.user.id);
  if (existing) {
    return res.status(409).json({ message: "Username นี้ถูกใช้ไปแล้ว" });
  }

  db.prepare("UPDATE users SET username = ? WHERE id = ?").run(trimmed, req.user.id);
  return res.json({ message: "แก้ไขชื่อผู้ใช้สำเร็จ", username: trimmed });
});

// ---------- POST /api/auth/change-password ----------
// เปลี่ยนรหัสผ่านจากในระบบ (ต้องยืนยันรหัสผ่านปัจจุบันก่อน ต่างจาก reset-password ที่ใช้ token จากอีเมล)
router.post("/change-password", requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ message: "กรุณากรอกข้อมูลให้ครบทุกช่อง" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ message: "รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร" });
    }
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ message: "รหัสผ่านใหม่ไม่ตรงกัน" });
    }

    const user = db.prepare("SELECT id, password_hash FROM users WHERE id = ?").get(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "ไม่พบผู้ใช้งาน" });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ message: "รหัสผ่านปัจจุบันไม่ถูกต้อง" });
    }
    if (currentPassword === newPassword) {
      return res.status(400).json({ message: "รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม" });
    }

    // เปลี่ยนรหัสผ่านแล้วล้าง reset token ที่ค้างอยู่ทิ้ง (ถ้าเคยกดลืมรหัสผ่านไว้ ลิงก์เก่าต้องใช้ไม่ได้อีก)
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    db.prepare(
      "UPDATE users SET password_hash = ?, reset_token_hash = NULL, reset_token_expires = NULL WHERE id = ?"
    ).run(passwordHash, user.id);

    return res.json({ message: "เปลี่ยนรหัสผ่านสำเร็จ กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่" });
  } catch (err) {
    console.error("Change password error:", err);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์" });
  }
});

// ---------- POST /api/auth/forgot-password ----------
// ขอลิงก์รีเซ็ตรหัสผ่านด้วยอีเมล
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !EMAIL_REGEX.test(email)) {
      return res.status(400).json({ message: "กรุณากรอกอีเมลให้ถูกต้อง" });
    }

    const user = db.prepare("SELECT id FROM users WHERE email = ?").get(email);

    // สำคัญ: ตอบกลับข้อความเดียวกันไม่ว่าจะเจอ email หรือไม่
    // เพื่อป้องกันคนร้ายใช้ endpoint นี้เดาว่าอีเมลไหนสมัครสมาชิกไว้บ้าง
    const genericMessage =
      "หากอีเมลนี้มีอยู่ในระบบ เราได้ส่งลิงก์สำหรับรีเซ็ตรหัสผ่านไปให้แล้ว";

    if (!user) {
      return res.json({ message: genericMessage });
    }

    // ---- สร้าง reset token ----
    const rawToken = crypto.randomBytes(32).toString("hex"); // ส่งให้ผู้ใช้ (ทางอีเมลจริงๆ)
    const tokenHash = hashToken(rawToken); // เก็บลงฐานข้อมูลแบบ hash เท่านั้น
    const expiresAt = new Date(
      Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000
    ).toISOString();

    db.prepare(
      "UPDATE users SET reset_token_hash = ?, reset_token_expires = ? WHERE id = ?"
    ).run(tokenHash, expiresAt, user.id);

    // ---- สร้างลิงก์สำหรับรีเซ็ตรหัสผ่าน ----
    const frontendOrigin = process.env.FRONTEND_ORIGIN || "http://localhost:5500";
    const resetUrl = `${frontendOrigin}/newpassword.html?token=${rawToken}`;

    // ---- ส่งอีเมลจริงผ่าน Gmail SMTP ----
    try {
      await sendPasswordResetEmail(email, resetUrl);
      return res.json({ message: genericMessage });
    } catch (mailErr) {
      if (mailErr.code === "EMAIL_NOT_CONFIGURED") {
        // ยังไม่ได้ตั้งค่า EMAIL_USER / EMAIL_APP_PASSWORD ใน .env
        // แสดงลิงก์ตรงๆ ใน response แทน เพื่อให้ยังทดสอบต่อได้ระหว่างพัฒนา
        console.log(`[DEV] ยังไม่ได้ตั้งค่าอีเมล — ลิงก์รีเซ็ตรหัสผ่านสำหรับ ${email}:`);
        console.log(resetUrl);
        return res.json({ message: genericMessage, devResetUrl: resetUrl });
      }

      // ส่งอีเมลไม่สำเร็จด้วยเหตุผลอื่น (เช่น App Password ผิด, เน็ตหลุด)
      console.error("Send reset email failed:", mailErr);
      return res
        .status(500)
        .json({ message: "ไม่สามารถส่งอีเมลได้ในขณะนี้ กรุณาลองใหม่ภายหลัง" });
    }
  } catch (err) {
    console.error("Forgot password error:", err);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์" });
  }
});

// ---------- POST /api/auth/reset-password ----------
// ตั้งรหัสผ่านใหม่ด้วย token ที่ได้จากอีเมล
router.post("/reset-password", async (req, res) => {
  try {
    const { token, newPassword, confirmPassword } = req.body;

    if (!token || !newPassword || !confirmPassword) {
      return res.status(400).json({ message: "ข้อมูลไม่ครบถ้วน" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ message: "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร" });
    }
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ message: "รหัสผ่านไม่ตรงกัน" });
    }

    const tokenHash = hashToken(token);
    const user = db
      .prepare(
        "SELECT id, reset_token_expires FROM users WHERE reset_token_hash = ?"
      )
      .get(tokenHash);

    if (!user) {
      return res.status(400).json({ message: "ลิงก์รีเซ็ตรหัสผ่านไม่ถูกต้อง" });
    }

    const isExpired = new Date(user.reset_token_expires) < new Date();
    if (isExpired) {
      return res.status(400).json({ message: "ลิงก์รีเซ็ตรหัสผ่านหมดอายุแล้ว กรุณาขอลิงก์ใหม่" });
    }

    // ---- ตั้งรหัสผ่านใหม่ แล้วล้าง token ทิ้งทันที (ใช้ได้ครั้งเดียว) ----
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    db.prepare(
      "UPDATE users SET password_hash = ?, reset_token_hash = NULL, reset_token_expires = NULL WHERE id = ?"
    ).run(passwordHash, user.id);

    return res.json({ message: "ตั้งรหัสผ่านใหม่สำเร็จ กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่" });
  } catch (err) {
    console.error("Reset password error:", err);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์" });
  }
});

module.exports = router;
