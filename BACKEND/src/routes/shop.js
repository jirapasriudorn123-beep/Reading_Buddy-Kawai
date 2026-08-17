const express = require("express");
const db = require("../db/database");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// ---------- GET /api/shop/products ----------
// ดึงรายการสินค้าทั้งหมด (public ข้อมูลไม่ลับ แต่ยังคงบังคับ login เพื่อความเรียบง่าย)
router.get("/products", requireAuth, (req, res) => {
  const products = db.prepare("SELECT * FROM products ORDER BY category, name").all();
  return res.json({ products });
});

// ---------- GET /api/shop/inventory ----------
// ดึงคลังสินค้าที่ผู้ใช้ซื้อไปแล้ว
router.get("/inventory", requireAuth, (req, res) => {
  const inventory = db
    .prepare(
      `SELECT p.id, p.name, p.img, p.category, p.pet_action, p.stat_gain, i.count
       FROM inventory i
       JOIN products p ON p.id = i.product_id
       WHERE i.user_id = ?
       ORDER BY p.name`
    )
    .all(req.user.id);

  return res.json({ inventory });
});

// ---------- POST /api/shop/buy ----------
// ซื้อสินค้าครั้งละกี่ชิ้นก็ได้ (ราคาอ้างอิงจากฐานข้อมูลเสมอ ไม่เชื่อราคาที่ client ส่งมา กันโกง)
// body: { productId, quantity? }  — ไม่ส่ง quantity มาถือว่าซื้อ 1 ชิ้นเหมือนเดิม
const MAX_BUY_QUANTITY = 99;

router.post("/buy", requireAuth, (req, res) => {
  try {
    const { productId } = req.body;

    // รับได้ทั้งไม่ส่งมาเลย (= 1 ชิ้น) และส่งเป็นตัวเลข ต้องเป็นจำนวนเต็มบวกเท่านั้น
    const quantity = req.body.quantity === undefined ? 1 : Number(req.body.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_BUY_QUANTITY) {
      return res.status(400).json({ message: `จำนวนที่ซื้อต้องเป็นจำนวนเต็ม 1-${MAX_BUY_QUANTITY} ชิ้น` });
    }

    const product = db.prepare("SELECT * FROM products WHERE id = ?").get(productId);
    if (!product) {
      return res.status(404).json({ message: "ไม่พบสินค้านี้" });
    }

    const totalPrice = product.price * quantity;
    const user = db.prepare("SELECT coins FROM users WHERE id = ?").get(req.user.id);
    if (user.coins < totalPrice) {
      return res.status(400).json({
        message: `เหรียญไม่พอ — ${product.name} ${quantity} ชิ้นราคา ${totalPrice} เหรียญ แต่คุณมี ${user.coins} เหรียญ`,
      });
    }

    const buyTransaction = db.transaction(() => {
      db.prepare("UPDATE users SET coins = coins - ? WHERE id = ?").run(totalPrice, req.user.id);

      db.prepare(
        `INSERT INTO inventory (user_id, product_id, count)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id, product_id) DO UPDATE SET count = count + excluded.count`
      ).run(req.user.id, productId, quantity);

      // บันทึกประวัติแยกรายชิ้น เพื่อให้ยอดรวมในหน้าแดชบอร์ดแอดมินยังคำนวณถูกเหมือนเดิม
      const logPurchase = db.prepare(
        `INSERT INTO purchase_log (user_id, product_name, price) VALUES (?, ?, ?)`
      );
      for (let i = 0; i < quantity; i++) {
        logPurchase.run(req.user.id, product.name, product.price);
      }
    });
    buyTransaction();

    const updatedUser = db.prepare("SELECT coins FROM users WHERE id = ?").get(req.user.id);

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
