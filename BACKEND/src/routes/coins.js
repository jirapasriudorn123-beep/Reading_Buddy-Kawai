const express = require("express");
const db = require("../db/database");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// ---------- GET /api/coins ----------
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const user = await db.prepare("SELECT coins FROM users WHERE id = ?").get(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "ไม่พบผู้ใช้งาน" });
    }
    return res.json({ coins: user.coins });
  } catch (err) {
    next(err);
  }
});

// ---------- POST /api/coins/spend ----------
router.post("/spend", requireAuth, async (req, res) => {
  try {
    const amount = Number(req.body.amount);

    if (!Number.isInteger(amount) || amount <= 0) {
      return res.status(400).json({ message: "จำนวนเหรียญที่ใช้จ่ายไม่ถูกต้อง" });
    }

    const user = await db.prepare("SELECT coins FROM users WHERE id = ?").get(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "ไม่พบผู้ใช้งาน" });
    }
    if (user.coins < amount) {
      return res.status(400).json({ message: "เหรียญไม่พอ" });
    }

    await db.prepare("UPDATE users SET coins = coins - ? WHERE id = ?").run(amount, req.user.id);
    const updated = await db.prepare("SELECT coins FROM users WHERE id = ?").get(req.user.id);

    return res.json({ message: "ใช้จ่ายเหรียญสำเร็จ", coins: updated.coins });
  } catch (err) {
    console.error("Spend coins error:", err);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์" });
  }
});

module.exports = router;
