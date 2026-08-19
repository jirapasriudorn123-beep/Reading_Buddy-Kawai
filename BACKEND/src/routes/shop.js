const express = require("express");
const db = require("../db/database");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// ---------- GET /api/shop/products ----------
// คืน products + reading total ของ user (นาที) ให้ frontend คำนวณเปอร์เซ็นต์ปลดล็อคคูปองได้เลย
router.get("/products", requireAuth, async (req, res, next) => {
  try {
    const [products, readingRow] = await Promise.all([
      db.prepare("SELECT * FROM products ORDER BY category, name").all(),
      db
        .prepare(
          "SELECT COALESCE(SUM(planned_read_seconds), 0) AS s FROM reading_sessions WHERE user_id = ? AND status = 'completed'"
        )
        .get(req.user.id),
    ]);
    const readingMinutes = Math.floor((readingRow.s || 0) / 60);
    return res.json({ products, readingMinutes });
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/shop/inventory ----------
router.get("/inventory", requireAuth, async (req, res, next) => {
  try {
    const inventory = await db
      .prepare(
        `SELECT p.id, p.name, p.img, p.category, p.pet_action, p.stat_gain, i.count
         FROM inventory i
         JOIN products p ON p.id = i.product_id
         WHERE i.user_id = ?
         ORDER BY p.name`
      )
      .all(req.user.id);

    return res.json({ inventory });
  } catch (err) {
    next(err);
  }
});

// ---------- POST /api/shop/buy ----------
const MAX_BUY_QUANTITY = 99;

router.post("/buy", requireAuth, async (req, res) => {
  try {
    const { productId } = req.body;

    const quantity = req.body.quantity === undefined ? 1 : Number(req.body.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_BUY_QUANTITY) {
      return res.status(400).json({ message: `จำนวนที่ซื้อต้องเป็นจำนวนเต็ม 1-${MAX_BUY_QUANTITY} ชิ้น` });
    }

    const product = await db.prepare("SELECT * FROM products WHERE id = ?").get(productId);
    if (!product) {
      return res.status(404).json({ message: "ไม่พบสินค้านี้" });
    }

    // สินค้าที่ต้องอ่านสะสมก่อน (คูปอง) เช็ค reading total ก่อนขาย
    // ใช้ planned_read_seconds จาก reading_sessions ที่ status='completed' เท่านั้น (ตรงกับ admin dashboard)
    if (product.required_reading_minutes > 0) {
      const requiredSeconds = product.required_reading_minutes * 60;
      const row = await db
        .prepare(
          "SELECT COALESCE(SUM(planned_read_seconds), 0) AS s FROM reading_sessions WHERE user_id = ? AND status = 'completed'"
        )
        .get(req.user.id);
      const totalSeconds = row.s || 0;
      if (totalSeconds < requiredSeconds) {
        const hoursHave = Math.floor(totalSeconds / 3600);
        const minsHave = Math.floor((totalSeconds % 3600) / 60);
        const hoursNeed = Math.floor(requiredSeconds / 3600);
        const minsNeed = Math.floor((requiredSeconds % 3600) / 60);
        return res.status(400).json({
          message:
            `ต้องอ่านสะสม ${hoursNeed} ชั่วโมง ${minsNeed} นาที ถึงจะแลกได้ ` +
            `(ตอนนี้อ่านไป ${hoursHave} ชั่วโมง ${minsHave} นาที)`,
        });
      }
    }

    const totalPrice = product.price * quantity;

    // เช็คยอดเหรียญปัจจุบัน (ถ้าสินค้าฟรี totalPrice = 0 → เช็คนี้ผ่านเสมอ)
    const user = await db.prepare("SELECT coins FROM users WHERE id = ?").get(req.user.id);
    if (totalPrice > 0 && user.coins < totalPrice) {
      return res.status(400).json({
        message: `เหรียญไม่พอ — ${product.name} ${quantity} ชิ้นราคา ${totalPrice} เหรียญ แต่คุณมี ${user.coins} เหรียญ`,
      });
    }

    try {
      await db.tx(async (t) => {
        if (totalPrice > 0) {
          // หักเหรียญเฉพาะสินค้าที่มีราคา — atomic guard กัน race condition
          const update = await t
            .prepare("UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?")
            .run(totalPrice, req.user.id, totalPrice);
          if (update.changes === 0) {
            const err = new Error("INSUFFICIENT_COINS");
            err.code = "INSUFFICIENT_COINS";
            throw err;
          }
        }

        await t.prepare(
          `INSERT INTO inventory (user_id, product_id, count)
           VALUES (?, ?, ?)
           ON CONFLICT(user_id, product_id) DO UPDATE SET count = count + excluded.count`
        ).run(req.user.id, productId, quantity);

        for (let i = 0; i < quantity; i++) {
          await t.prepare(
            `INSERT INTO purchase_log (user_id, product_name, price) VALUES (?, ?, ?)`
          ).run(req.user.id, product.name, product.price);
        }
      });
    } catch (txErr) {
      if (txErr.code === "INSUFFICIENT_COINS") {
        const nowUser = await db.prepare("SELECT coins FROM users WHERE id = ?").get(req.user.id);
        return res.status(400).json({
          message: `เหรียญไม่พอ — ต้องใช้ ${totalPrice} เหรียญ แต่คุณมี ${nowUser?.coins ?? 0} เหรียญ`,
        });
      }
      throw txErr;
    }

    const updatedUser = await db.prepare("SELECT coins FROM users WHERE id = ?").get(req.user.id);

    return res.json({
      message:
        quantity > 1
          ? `🎉 ซื้อสำเร็จ! คุณได้รับ ${product.name} ${quantity} ชิ้น (${totalPrice} เหรียญ)`
          : `🎉 ซื้อสำเร็จ! คุณได้รับ ${product.name}`,
      coins: updatedUser.coins,
      quantity,
      totalPrice,
      product: { id: product.id, name: product.name, img: product.img },
    });
  } catch (err) {
    console.error("Buy product error:", err);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์" });
  }
});

module.exports = router;
