const express = require("express");
const db = require("../db/database");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// ---------- GET /api/shop/products ----------
router.get("/products", requireAuth, async (req, res, next) => {
  try {
    const products = await db.prepare("SELECT * FROM products ORDER BY category, name").all();
    return res.json({ products });
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

    const totalPrice = product.price * quantity;

    // เช็คยอดเหรียญปัจจุบันไว้ใช้ในข้อความ error (แค่แจ้งเบื้องต้น — การหักจริงเช็ค atomic ใน UPDATE ด้านล่างอีกที)
    const user = await db.prepare("SELECT coins FROM users WHERE id = ?").get(req.user.id);
    if (user.coins < totalPrice) {
      return res.status(400).json({
        message: `เหรียญไม่พอ — ${product.name} ${quantity} ชิ้นราคา ${totalPrice} เหรียญ แต่คุณมี ${user.coins} เหรียญ`,
      });
    }

    try {
      await db.tx(async (t) => {
        // WHERE coins >= ? = atomic guard กันโกง/race condition
        // เดิมเช็ค user.coins แยกก่อน UPDATE โล่งๆ ถ้า user เปิด 2 แท็บกดซื้อพร้อมกันทั้งคู่จะเห็นยอดเดิม
        // แล้วหักผ่านทั้งคู่ → ติดลบได้
        const update = await t
          .prepare("UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?")
          .run(totalPrice, req.user.id, totalPrice);
        if (update.changes === 0) {
          const err = new Error("INSUFFICIENT_COINS");
          err.code = "INSUFFICIENT_COINS";
          throw err;
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
        // ยอดจริงถูกหักไปแล้วโดย request อื่นระหว่างที่เราเช็ค — ตอบเหมือนเคสยอดไม่พอปกติ
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
