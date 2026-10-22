const express = require("express");
const db = require("../db/database");
const { requireAuth } = require("../middleware/auth");
const { redeemCoupon, isRealCoupon, isUnsetCoupon } = require("./coupons");
const { passedChapterCount, clearedWorldCount } = require("../services/chapterTests");

const router = express.Router();

// เงื่อนไขแลกคูปอง: ผ่านแบบทดสอบหลังอ่าน (≥ 60%) กี่บท + ผ่านด่านบทเรียนในเกมกี่โลก (คอยน์เป็นราคาที่ต้องจ่ายแยกต่างหาก)
async function couponProgress(userId) {
  const [passedChapters, clearedWorlds] = await Promise.all([passedChapterCount(userId), clearedWorldCount(userId)]);
  return { passedChapters, clearedWorlds };
}

function couponUnlocked(product, progress) {
  return (
    progress.passedChapters >= (product.required_post_chapters || 0) &&
    progress.clearedWorlds >= (product.required_game_worlds || 0)
  );
}

// ---------- GET /api/shop/products ----------
// คืน products + ความคืบหน้าเงื่อนไขคูปองของ user ให้ frontend โชว์ว่าปลดล็อคคูปองไหนแล้ว
router.get("/products", requireAuth, async (req, res, next) => {
  try {
    const [products, progress, couponRows, user] = await Promise.all([
      db.prepare("SELECT * FROM products ORDER BY category, name").all(),
      couponProgress(req.user.id),
      db.prepare("SELECT product_id FROM user_coupons WHERE user_id = ?").all(req.user.id),
      db.prepare("SELECT univ_verified_at FROM users WHERE id = ?").get(req.user.id),
    ]);
    return res.json({
      products,
      couponProgress: progress,
      // คูปองแบบที่แลกไปแล้ว (แต่ละแบบแลกได้ครั้งเดียว) + ยืนยันอีเมลมหาวิทยาลัยแล้วหรือยัง
      redeemedCouponIds: couponRows.map((r) => r.product_id),
      univVerified: !!(user && user.univ_verified_at),
    });
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
    if (isUnsetCoupon(product)) {
      return res.status(400).json({ message: "คูปองนี้ยังไม่พร้อมใช้งาน (แอดมินยังไม่ได้ตั้งมูลค่าส่วนลด)" });
    }

    // คูปอง: ต้องผ่านแบบทดสอบหลังอ่านครบจำนวนบท + ผ่านด่านบทเรียนในเกมครบจำนวนโลก ก่อนแลก
    if (product.required_post_chapters > 0 || product.required_game_worlds > 0) {
      const progress = await couponProgress(req.user.id);
      if (!couponUnlocked(product, progress)) {
        return res.status(400).json({
          message:
            `ยังแลกคูปองนี้ไม่ได้ — ต้องผ่านแบบทดสอบหลังอ่าน ${product.required_post_chapters} บท ` +
            `(ตอนนี้ ${progress.passedChapters} บท)` +
            (product.required_game_worlds > 0
              ? ` และผ่านด่านบทเรียนในเกม ${product.required_game_worlds} โลก (ตอนนี้ ${progress.clearedWorlds} โลก)`
              : ""),
        });
      }
    }

    // คูปองส่วนลดร้านจริง: ไม่เข้ากระเป๋า แต่ออกเป็นคูปองที่มีรหัส + วันหมดอายุ
    if (isRealCoupon(product)) {
      return await redeemCoupon(req, res, product, quantity);
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
