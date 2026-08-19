require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
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

// ---- middleware พื้นฐาน ----
app.use(express.json()); // อ่าน JSON body จาก request
app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN || "*", // จำกัดว่า frontend จากที่ไหนเรียก API ได้บ้าง
  })
);

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
