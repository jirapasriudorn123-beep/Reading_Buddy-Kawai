const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const db = require("../db/database");
const { requireAuth } = require("../middleware/auth");
const { sendPasswordResetEmail, sendUnivVerificationEmail } = require("../utils/mailer");
const { avatarUpload } = require("../utils/cloudinary");

const router = express.Router();
const SALT_ROUNDS = 10;
const RESET_TOKEN_TTL_MINUTES = 15;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOOPBACK_ADDRESSES = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];

// อีเมลนิสิต ม.พะเยา — ต้องยืนยันก่อนแลกคูปองส่วนลด (กันสมัครหลายบัญชีมาแลกซ้ำ)
const UNIV_EMAIL_REGEX = /^[a-z0-9._%+-]+@up\.ac\.th$/;
const UNIV_VERIFY_TTL_MINUTES = 30;

// URL หน้าเว็บสำหรับลิงก์ในอีเมล (รวม path ของ GitHub Pages เช่น https://<user>.github.io/<repo>)
// แยกจาก FRONTEND_ORIGIN เพราะค่านั้นใช้กับ CORS ซึ่งต้องเป็น origin ล้วนๆ ไม่มี path
function frontendUrl() {
  return (process.env.FRONTEND_URL || process.env.FRONTEND_ORIGIN || "http://localhost:5500").replace(/\/+$/, "");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// normalize email เป็น lowercase + trim ทุกครั้งก่อนใช้/save
// กันเคส User A สมัคร "John@x.com" แล้ว User B สมัคร "john@x.com" ได้ทั้งคู่ (DB มองต่างกัน)
// และเคส user พิมพ์ "  john@x.com " ตอน login แล้ว WHERE email = ? หา match ไม่เจอ
function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

// ---------- POST /api/auth/register ----------
router.post("/register", async (req, res) => {
  try {
    const { email: rawEmail, username: rawUsername, password, confirmPassword } = req.body;

    if (!rawEmail || !rawUsername || !password || !confirmPassword) {
      return res.status(400).json({ message: "กรุณากรอกข้อมูลให้ครบทุกช่อง" });
    }

    const email = normalizeEmail(rawEmail);
    const username = typeof rawUsername === "string" ? rawUsername.trim() : "";

    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ message: "รูปแบบอีเมลไม่ถูกต้อง" });
    }
    if (username.length < 3) {
      return res.status(400).json({ message: "Username ต้องมีอย่างน้อย 3 ตัวอักษร" });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร" });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ message: "รหัสผ่านไม่ตรงกัน" });
    }

    const existing = await db
      .prepare("SELECT id FROM users WHERE email = ? OR username = ?")
      .get(email, username);

    if (existing) {
      return res.status(409).json({ message: "อีเมลหรือ Username นี้ถูกใช้ไปแล้ว" });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const result = await db
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
    const { email: rawEmail, password } = req.body;

    if (!rawEmail || !password) {
      return res.status(400).json({ message: "กรุณากรอกอีเมลและรหัสผ่าน" });
    }

    const email = normalizeEmail(rawEmail);
    const user = await db.prepare("SELECT * FROM users WHERE email = ?").get(email);

    if (!user) {
      return res.status(401).json({ message: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ message: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });
    }

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

// ---------- GET /api/auth/me ----------
router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const user = await db
      .prepare(
        "SELECT id, email, username, coins, is_admin, avatar_url, created_at, univ_verified_at FROM users WHERE id = ?"
      )
      .get(req.user.id);

    if (!user) {
      return res.status(404).json({ message: "ไม่พบผู้ใช้งาน" });
    }

    const { univ_verified_at, ...rest } = user;
    return res.json({ user: { ...rest, avatarUrl: user.avatar_url, univVerified: !!univ_verified_at } });
  } catch (err) {
    next(err);
  }
});

// ---------- POST /api/auth/avatar ----------
// Cloudinary storage คืน URL เต็ม (https://res.cloudinary.com/.../xxx.png) ใน req.file.path
// เก็บลง DB เป็น URL เต็มเลย ไม่ต้อง prefix backend origin เหมือนก่อน
router.post("/avatar", requireAuth, avatarUpload.single("avatar"), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "อัปโหลดรูปไม่สำเร็จ (ชนิดไฟล์ไม่รองรับ หรือไฟล์ใหญ่เกิน 5MB)" });
    }

    const avatarUrl = req.file.path;
    await db.prepare("UPDATE users SET avatar_url = ? WHERE id = ?").run(avatarUrl, req.user.id);

    return res.json({ message: "อัปเดตรูปโปรไฟล์สำเร็จ", avatarUrl });
  } catch (err) {
    next(err);
  }
});

// ---------- PUT /api/auth/username ----------
router.put("/username", requireAuth, async (req, res, next) => {
  try {
    const { username } = req.body;
    if (!username || username.trim().length < 3) {
      return res.status(400).json({ message: "Username ต้องมีอย่างน้อย 3 ตัวอักษร" });
    }

    const trimmed = username.trim();
    const existing = await db.prepare("SELECT id FROM users WHERE username = ? AND id != ?").get(trimmed, req.user.id);
    if (existing) {
      return res.status(409).json({ message: "Username นี้ถูกใช้ไปแล้ว" });
    }

    await db.prepare("UPDATE users SET username = ? WHERE id = ?").run(trimmed, req.user.id);
    return res.json({ message: "แก้ไขชื่อผู้ใช้สำเร็จ", username: trimmed });
  } catch (err) {
    next(err);
  }
});

// ---------- POST /api/auth/change-password ----------
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

    const user = await db.prepare("SELECT id, password_hash FROM users WHERE id = ?").get(req.user.id);
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

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await db.prepare(
      "UPDATE users SET password_hash = ?, reset_token_hash = NULL, reset_token_expires = NULL WHERE id = ?"
    ).run(passwordHash, user.id);

    return res.json({ message: "เปลี่ยนรหัสผ่านสำเร็จ กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่" });
  } catch (err) {
    console.error("Change password error:", err);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์" });
  }
});

// ---------- POST /api/auth/forgot-password ----------
router.post("/forgot-password", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);

    if (!email || !EMAIL_REGEX.test(email)) {
      return res.status(400).json({ message: "กรุณากรอกอีเมลให้ถูกต้อง" });
    }

    const user = await db.prepare("SELECT id FROM users WHERE email = ?").get(email);

    const genericMessage =
      "หากอีเมลนี้มีอยู่ในระบบ เราได้ส่งลิงก์สำหรับรีเซ็ตรหัสผ่านไปให้แล้ว";

    if (!user) {
      return res.json({ message: genericMessage });
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(
      Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000
    ).toISOString();

    await db.prepare(
      "UPDATE users SET reset_token_hash = ?, reset_token_expires = ? WHERE id = ?"
    ).run(tokenHash, expiresAt, user.id);

    const resetUrl = `${frontendUrl()}/newpassword.html?token=${rawToken}`;

    try {
      await sendPasswordResetEmail(email, resetUrl);
      return res.json({ message: genericMessage });
    } catch (mailErr) {
      if (mailErr.code === "EMAIL_NOT_CONFIGURED") {
        console.log(`[DEV] ยังไม่ได้ตั้งค่าอีเมล — ลิงก์รีเซ็ตรหัสผ่านสำหรับ ${email}:`);
        console.log(resetUrl);
        // ส่งลิงก์กลับไปให้หน้าเว็บเฉพาะตอนเรียกจากเครื่องตัวเอง (dev) เท่านั้น
        // ถ้าเซิร์ฟเวอร์จริงลืมตั้งค่าอีเมล ห้ามส่งลิงก์กลับ ไม่งั้นใครพิมพ์อีเมลคนอื่นก็ยึดบัญชีได้
        // ใช้ IP ของ socket ตรงๆ (ปลอมผ่าน header ไม่ได้ ต่างจาก req.ip ที่เชื่อ X-Forwarded-For)
        if (LOOPBACK_ADDRESSES.includes(req.socket.remoteAddress)) {
          return res.json({ message: genericMessage, devResetUrl: resetUrl });
        }
        return res.json({ message: genericMessage });
      }

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

// ---------- POST /api/auth/univ-email/request ----------
// ส่งลิงก์ยืนยันไปที่อีเมลมหาวิทยาลัย (@up.ac.th) — ยืนยันแล้วถึงจะแลกคูปองได้
// เก็บแค่ SHA-256 ของอีเมล (ไม่เก็บอีเมลจริง) พอสำหรับเช็คว่าอีเมลนี้เคยใช้ยืนยันบัญชีอื่นแล้วหรือยัง
router.post("/univ-email/request", requireAuth, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    if (!UNIV_EMAIL_REGEX.test(email)) {
      return res.status(400).json({ message: "กรุณากรอกอีเมลมหาวิทยาลัยที่ลงท้ายด้วย @up.ac.th" });
    }

    const user = await db.prepare("SELECT univ_verified_at FROM users WHERE id = ?").get(req.user.id);
    if (!user) return res.status(404).json({ message: "ไม่พบผู้ใช้งาน" });
    if (user.univ_verified_at) {
      return res.status(400).json({ message: "บัญชีนี้ยืนยันอีเมลมหาวิทยาลัยแล้ว" });
    }

    const emailHash = hashToken(email);
    const taken = await db
      .prepare("SELECT id FROM users WHERE univ_email_hash = ? AND id != ?")
      .get(emailHash, req.user.id);
    if (taken) {
      return res.status(409).json({ message: "อีเมลนี้ถูกใช้ยืนยันกับบัญชีอื่นแล้ว (1 อีเมลยืนยันได้ 1 บัญชี)" });
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + UNIV_VERIFY_TTL_MINUTES * 60 * 1000).toISOString();
    await db
      .prepare(
        `INSERT INTO univ_email_verifications (user_id, email_hash, token_hash, expires_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET email_hash = excluded.email_hash, token_hash = excluded.token_hash,
           expires_at = excluded.expires_at, created_at = datetime('now')`
      )
      .run(req.user.id, emailHash, hashToken(rawToken), expiresAt);

    const verifyUrl = `${frontendUrl()}/verify-email.html?token=${rawToken}`;
    const message = `ส่งลิงก์ยืนยันไปที่ ${email} แล้ว กรุณาเปิดอีเมลแล้วกดลิงก์ภายใน ${UNIV_VERIFY_TTL_MINUTES} นาที (ถ้าไม่เจอให้ดูในโฟลเดอร์สแปม)`;

    try {
      await sendUnivVerificationEmail(email, verifyUrl);
      return res.json({ message });
    } catch (mailErr) {
      if (mailErr.code === "EMAIL_NOT_CONFIGURED") {
        console.log(`[DEV] ยังไม่ได้ตั้งค่าอีเมล — ลิงก์ยืนยันอีเมลมหาวิทยาลัย: ${verifyUrl}`);
        // เหมือนลืมรหัสผ่าน: ส่งลิงก์กลับมาให้หน้าเว็บเฉพาะตอนเรียกจากเครื่องตัวเองเท่านั้น
        if (LOOPBACK_ADDRESSES.includes(req.socket.remoteAddress)) {
          return res.json({ message, devVerifyUrl: verifyUrl });
        }
      } else {
        console.error("Send univ verification email failed:", mailErr);
      }
      return res.status(500).json({ message: "ไม่สามารถส่งอีเมลได้ในขณะนี้ กรุณาลองใหม่ภายหลัง" });
    }
  } catch (err) {
    next(err);
  }
});

// ---------- POST /api/auth/univ-email/verify ----------
// เปิดจากลิงก์ในอีเมล (ไม่ต้อง login — token ในลิงก์บอกอยู่แล้วว่าเป็นบัญชีไหน)
router.post("/univ-email/verify", async (req, res, next) => {
  try {
    const { token } = req.body;
    if (!token || typeof token !== "string") {
      return res.status(400).json({ message: "ลิงก์ยืนยันไม่ถูกต้อง" });
    }

    const pending = await db
      .prepare("SELECT user_id, email_hash, expires_at FROM univ_email_verifications WHERE token_hash = ?")
      .get(hashToken(token));
    if (!pending) {
      return res.status(400).json({ message: "ลิงก์ยืนยันไม่ถูกต้อง หรือถูกใช้ไปแล้ว" });
    }
    if (new Date(pending.expires_at) < new Date()) {
      return res.status(400).json({ message: "ลิงก์ยืนยันหมดอายุแล้ว กรุณาขอลิงก์ใหม่ที่หน้าร้านค้า" });
    }

    try {
      await db.tx(async (t) => {
        await t.prepare(
          "UPDATE users SET univ_email_hash = ?, univ_verified_at = datetime('now') WHERE id = ?"
        ).run(pending.email_hash, pending.user_id);
        await t.prepare("DELETE FROM univ_email_verifications WHERE user_id = ?").run(pending.user_id);
      });
    } catch (txErr) {
      // unique index: อีเมลนี้ไปยืนยันกับบัญชีอื่นก่อนแล้ว (กดลิงก์จากสองบัญชีพร้อมกัน)
      if (String(txErr.message).includes("UNIQUE")) {
        return res.status(409).json({ message: "อีเมลนี้ถูกใช้ยืนยันกับบัญชีอื่นแล้ว (1 อีเมลยืนยันได้ 1 บัญชี)" });
      }
      throw txErr;
    }

    return res.json({ message: "ยืนยันอีเมลมหาวิทยาลัยสำเร็จ แลกคูปองได้แล้ว" });
  } catch (err) {
    next(err);
  }
});

// ---------- POST /api/auth/reset-password ----------
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
    const user = await db
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

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await db.prepare(
      "UPDATE users SET password_hash = ?, reset_token_hash = NULL, reset_token_expires = NULL WHERE id = ?"
    ).run(passwordHash, user.id);

    return res.json({ message: "ตั้งรหัสผ่านใหม่สำเร็จ กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่" });
  } catch (err) {
    console.error("Reset password error:", err);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์" });
  }
});

module.exports = router;
