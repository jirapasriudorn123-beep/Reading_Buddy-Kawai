require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const rateLimit = require("express-rate-limit");
const db = require("./db/database");

const authRoutes = require("./routes/auth");
const goalRoutes = require("./routes/goal");
const chapterRoutes = require("./routes/chapters");
const sessionRoutes = require("./routes/sessions");
const coinRoutes = require("./routes/coins");
const analyticsRoutes = require("./routes/analytics");
const petRoutes = require("./routes/pet");
const shopRoutes = require("./routes/shop");
const gameRoutes = require("./routes/game");
const adminRoutes = require("./routes/admin");
const notificationRoutes = require("./routes/notifications");
const chatRoutes = require("./routes/chat").router;

const app = express();
const PORT = process.env.PORT || 3000;

// Render (และ proxy อื่นๆ) ส่ง IP จริงของ client มาผ่าน X-Forwarded-For
// ต้องบอก Express ให้เชื่อ header นี้ ไม่งั้น rate limit จะเห็นทุก request มาจาก IP ของ proxy ตัวเดียว
app.set("trust proxy", 1);

// ---- middleware พื้นฐาน ----
app.use(express.json()); // อ่าน JSON body จาก request
app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN || "*", // จำกัดว่า frontend จากที่ไหนเรียก API ได้บ้าง
  })
);

// ---- rate limiting ----
// จำกัดทั่วไปสำหรับทุก /api endpoint กัน DoS/abuse ทั่วไป
const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 นาที
  max: 120, // 120 request ต่อ IP ต่อนาที (2 req/วิ) — เผื่อ user เปิดหลายแท็บ/หน้าโหลดหลายๆ endpoint พร้อมกัน
  standardHeaders: true, // ส่ง RateLimit-* headers ตามมาตรฐาน RFC ให้ client เห็นสถานะ
  legacyHeaders: false, // ปิด X-RateLimit-* header แบบเก่า
  message: { message: "เรียก API บ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่" },
});

// จำกัดเข้มสำหรับ endpoint ที่เสี่ยงต่อ brute force / spam (login, register, ลืมรหัสผ่าน)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 นาที
  max: 10, // 10 ครั้ง/15 นาที/IP — พอสำหรับ user พิมพ์ผิดหลายรอบ แต่กันสคริปต์เดารหัส
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอ 15 นาทีแล้วลองใหม่" },
  skipSuccessfulRequests: true, // login ผ่านแล้วไม่นับ (นับแค่ที่ 4xx/5xx เท่านั้น) ให้ user login ถูกไม่โดน block
});

app.use("/api", generalLimiter);
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);
app.use("/api/auth/forgot-password", authLimiter);
app.use("/api/auth/reset-password", authLimiter);

// ---- เปิดให้เข้าถึงไฟล์ที่อัปโหลดได้ (เช่น รูปโปรไฟล์) ----
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

// ---- routes ----
app.use("/api/auth", authRoutes);
app.use("/api/goal", goalRoutes);
app.use("/api/chapters", chapterRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/coins", coinRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/pet", petRoutes);
app.use("/api/shop", shopRoutes);
app.use("/api/game", gameRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/chat", chatRoutes);

// health check เอาไว้เช็คว่า server รันอยู่ไหม
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// ---- 404 fallback ----
app.use((req, res) => {
  res.status(404).json({ message: "ไม่พบ endpoint นี้" });
});

// error handler รวม (จับ error จาก async route ที่โยนผ่าน next(err))
app.use((err, req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ message: "เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์" });
});

db.init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`✅ Backend server กำลังรันที่ http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ เชื่อมต่อฐานข้อมูลไม่สำเร็จ:", err);
    process.exit(1);
  });
