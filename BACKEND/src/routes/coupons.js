const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const db = require("../db/database");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// ================== คูปองส่วนลดร้านค้าจริง ==================
// แลกด้วยคอยน์ในร้านค้า → ได้คูปองที่มีรหัสไม่ซ้ำ + QR หมดอายุใน 30 วัน
// ที่หน้าร้าน พนักงานสแกน QR (เปิด coupon-check.html) เลือกร้าน + ใส่ PIN ร้าน แล้วกดยืนยัน → คูปองเป็น "ใช้แล้ว" ใช้ซ้ำไม่ได้

const COUPON_VALID_DAYS = 30;
const MAX_COUPONS_PER_USER = 5; // คูปองมี 5 แบบ แต่ละแบบแลกได้ครั้งเดียว
const MAX_PIN_ATTEMPTS = 5; // ใส่ PIN ผิดครบเท่านี้ ล็อกร้านนั้นชั่วคราว (กันเดา PIN)
const PIN_LOCK_MINUTES = 15;

// ตัดตัวที่สับสนง่ายออก (0/O, 1/I/L) พนักงานพิมพ์รหัสเองได้ถ้าสแกนไม่ติด
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function generateCouponCode() {
  const pick = () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  const part = () => Array.from({ length: 4 }, pick).join("");
  return `RB-${part()}-${part()}`;
}

function normalizeCode(code) {
  return typeof code === "string" ? code.trim().toUpperCase() : "";
}

// สินค้าหมวดคูปองที่มีมูลค่าส่วนลด = คูปองที่ใช้ที่ร้านจริง (ของเก่าหมวดคูปองที่ไม่มีมูลค่ายังเป็นไอเทมธรรมดา)
function isRealCoupon(product) {
  return product.category === "คูปอง" && product.discount_baht > 0;
}

// หมวดคูปองที่แอดมินยังไม่ได้ตั้งมูลค่าส่วนลด และใช้กับน้องหมาไม่ได้ = ยังไม่พร้อมแลก
// (เดิมขายเป็นไอเทมธรรมดา หักคอยน์แล้วไปอยู่ในกระเป๋า ผู้ใช้หาใน "คูปองของฉัน" ไม่เจอ)
function isUnsetCoupon(product) {
  return product.category === "คูปอง" && !(product.discount_baht > 0) && !product.pet_action;
}

// สถานะที่ผู้ใช้/พนักงานเห็น: active ที่เลยวันหมดอายุแล้วนับเป็น expired (ไม่ต้องมีงานรันเปลี่ยนสถานะ)
const STATUS_SQL = `CASE WHEN uc.status = 'used' THEN 'used'
                         WHEN uc.expires_at <= datetime('now') THEN 'expired'
                         ELSE 'active' END`;

// ---------- แลกคูปอง (เรียกจาก POST /api/shop/buy เมื่อสินค้าเป็นคูปอง) ----------
async function redeemCoupon(req, res, product, quantity) {
  if (quantity !== 1) {
    return res.status(400).json({ message: "คูปองแลกได้ครั้งละ 1 ใบ" });
  }

  const user = await db.prepare("SELECT coins, univ_verified_at FROM users WHERE id = ?").get(req.user.id);
  if (!user.univ_verified_at) {
    return res.status(403).json({
      code: "UNIV_EMAIL_REQUIRED",
      message: "ต้องยืนยันอีเมลมหาวิทยาลัย (@up.ac.th) ก่อนแลกคูปอง",
    });
  }

  const owned = await db
    .prepare("SELECT COUNT(*) AS total, SUM(product_id = ?) AS same FROM user_coupons WHERE user_id = ?")
    .get(product.id, req.user.id);
  if (owned.same > 0) {
    return res.status(409).json({ message: "คุณแลกคูปองใบนี้ไปแล้ว (แต่ละแบบแลกได้ 1 ครั้ง)" });
  }
  if (owned.total >= MAX_COUPONS_PER_USER) {
    return res.status(400).json({ message: `แลกคูปองได้สูงสุด ${MAX_COUPONS_PER_USER} ใบต่อบัญชี` });
  }

  if (product.price > 0 && user.coins < product.price) {
    return res.status(400).json({
      message: `เหรียญไม่พอ — ${product.name} ใช้ ${product.price} เหรียญ แต่คุณมี ${user.coins} เหรียญ`,
    });
  }

  const code = generateCouponCode();
  try {
    await db.tx(async (t) => {
      if (product.price > 0) {
        const update = await t
          .prepare("UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?")
          .run(product.price, req.user.id, product.price);
        if (update.changes === 0) {
          const err = new Error("INSUFFICIENT_COINS");
          err.code = "INSUFFICIENT_COINS";
          throw err;
        }
      }
      // UNIQUE (user_id, product_id) กันกดแลกพร้อมกันหลายแท็บแล้วได้ใบเดียวกันซ้ำ
      await t.prepare(
        `INSERT INTO user_coupons (user_id, product_id, code, name, img, discount_baht, price_coins, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+${COUPON_VALID_DAYS} days'))`
      ).run(req.user.id, product.id, code, product.name, product.img, product.discount_baht, product.price);
      await t.prepare("INSERT INTO purchase_log (user_id, product_name, price) VALUES (?, ?, ?)").run(
        req.user.id,
        product.name,
        product.price
      );
    });
  } catch (txErr) {
    if (txErr.code === "INSUFFICIENT_COINS") {
      return res.status(400).json({ message: `เหรียญไม่พอ — ต้องใช้ ${product.price} เหรียญ` });
    }
    if (String(txErr.message).includes("UNIQUE")) {
      return res.status(409).json({ message: "คุณแลกคูปองใบนี้ไปแล้ว (แต่ละแบบแลกได้ 1 ครั้ง)" });
    }
    throw txErr;
  }

  const [updatedUser, coupon] = await Promise.all([
    db.prepare("SELECT coins FROM users WHERE id = ?").get(req.user.id),
    db.prepare("SELECT code, expires_at FROM user_coupons WHERE code = ?").get(code),
  ]);

  return res.json({
    message: `🎉 แลก${product.name} สำเร็จ! ใช้ได้ภายใน ${COUPON_VALID_DAYS} วัน ดูได้ที่ "คูปองของฉัน"`,
    coins: updatedUser.coins,
    quantity: 1,
    totalPrice: product.price,
    product: { id: product.id, name: product.name, img: product.img },
    coupon: { code: coupon.code, expiresAt: coupon.expires_at },
  });
}

// ---------- GET /api/coupons ----------
// คูปองของฉัน (ใหม่สุดก่อน)
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const coupons = await db
      .prepare(
        `SELECT uc.code, uc.product_id AS productId, uc.name, uc.img, uc.discount_baht AS discountBaht,
                ${STATUS_SQL} AS status, uc.created_at AS createdAt, uc.expires_at AS expiresAt,
                uc.used_at AS usedAt, ps.name AS usedShop
         FROM user_coupons uc
         LEFT JOIN partner_shops ps ON ps.id = uc.used_shop_id
         WHERE uc.user_id = ?
         ORDER BY uc.created_at DESC`
      )
      .all(req.user.id);
    return res.json({ coupons, maxCoupons: MAX_COUPONS_PER_USER });
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/coupons/shops ----------
// รายชื่อร้านที่ร่วมรายการ ให้พนักงานเลือกในหน้าตรวจคูปอง (ไม่ต้อง login)
router.get("/shops", async (req, res, next) => {
  try {
    const shops = await db
      .prepare("SELECT id, name FROM partner_shops WHERE pin_hash IS NOT NULL ORDER BY id ASC")
      .all();
    return res.json({ shops });
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/coupons/check/:code ----------
// หน้าที่เปิดขึ้นหลังพนักงานสแกน QR (ไม่ต้อง login) — แสดงแค่ข้อมูลคูปอง ไม่บอกว่าเป็นของใคร
router.get("/check/:code", async (req, res, next) => {
  try {
    const coupon = await db
      .prepare(
        `SELECT uc.code, uc.name, uc.discount_baht AS discountBaht, ${STATUS_SQL} AS status,
                uc.expires_at AS expiresAt, uc.used_at AS usedAt, ps.name AS usedShop
         FROM user_coupons uc
         LEFT JOIN partner_shops ps ON ps.id = uc.used_shop_id
         WHERE uc.code = ?`
      )
      .get(normalizeCode(req.params.code));
    if (!coupon) {
      return res.status(404).json({ message: "ไม่พบคูปองรหัสนี้ ตรวจสอบรหัสอีกครั้ง" });
    }
    return res.json({ coupon });
  } catch (err) {
    next(err);
  }
});

// ---------- POST /api/coupons/use ----------
// พนักงานยืนยันการใช้คูปองด้วย PIN ของร้าน (ไม่ต้อง login)
router.post("/use", async (req, res, next) => {
  try {
    const code = normalizeCode(req.body.code);
    const shopId = Number(req.body.shopId);
    const pin = typeof req.body.pin === "string" ? req.body.pin.trim() : "";
    if (!code || !Number.isInteger(shopId) || !pin) {
      return res.status(400).json({ message: "กรุณาเลือกร้านและกรอก PIN ร้าน" });
    }

    const shop = await db
      .prepare("SELECT id, name, pin_hash, failed_pin_count, locked_until FROM partner_shops WHERE id = ?")
      .get(shopId);
    if (!shop || !shop.pin_hash) {
      return res.status(400).json({ message: "ไม่พบร้านนี้ หรือร้านนี้ยังไม่ได้ตั้ง PIN" });
    }
    if (shop.locked_until && new Date(shop.locked_until + "Z") > new Date()) {
      return res.status(429).json({ message: `ใส่ PIN ผิดหลายครั้ง ร้านนี้ถูกล็อกชั่วคราว ลองใหม่ใน ${PIN_LOCK_MINUTES} นาที` });
    }

    const pinOk = await bcrypt.compare(pin, shop.pin_hash);
    if (!pinOk) {
      const failed = shop.failed_pin_count + 1;
      if (failed >= MAX_PIN_ATTEMPTS) {
        await db
          .prepare(
            `UPDATE partner_shops SET failed_pin_count = 0, locked_until = datetime('now', '+${PIN_LOCK_MINUTES} minutes')
             WHERE id = ?`
          )
          .run(shop.id);
        return res.status(429).json({ message: `ใส่ PIN ผิดครบ ${MAX_PIN_ATTEMPTS} ครั้ง ร้านนี้ถูกล็อก ${PIN_LOCK_MINUTES} นาที` });
      }
      await db.prepare("UPDATE partner_shops SET failed_pin_count = ? WHERE id = ?").run(failed, shop.id);
      return res.status(401).json({ message: `PIN ไม่ถูกต้อง (เหลืออีก ${MAX_PIN_ATTEMPTS - failed} ครั้ง)` });
    }
    if (shop.failed_pin_count > 0 || shop.locked_until) {
      await db.prepare("UPDATE partner_shops SET failed_pin_count = 0, locked_until = NULL WHERE id = ?").run(shop.id);
    }

    // เปลี่ยนเป็น "ใช้แล้ว" ได้เฉพาะคูปองที่ยังใช้ได้และยังไม่หมดอายุ — สองร้านกดพร้อมกันก็สำเร็จได้แค่ครั้งเดียว
    const result = await db
      .prepare(
        `UPDATE user_coupons SET status = 'used', used_at = datetime('now'), used_shop_id = ?
         WHERE code = ? AND status = 'active' AND expires_at > datetime('now')`
      )
      .run(shop.id, code);

    const coupon = await db
      .prepare(
        `SELECT uc.code, uc.name, uc.discount_baht AS discountBaht, ${STATUS_SQL} AS status,
                uc.expires_at AS expiresAt, uc.used_at AS usedAt, ps.name AS usedShop
         FROM user_coupons uc
         LEFT JOIN partner_shops ps ON ps.id = uc.used_shop_id
         WHERE uc.code = ?`
      )
      .get(code);
    if (!coupon) {
      return res.status(404).json({ message: "ไม่พบคูปองรหัสนี้" });
    }
    if (result.changes === 0) {
      const reason = coupon.status === "used" ? "คูปองนี้ถูกใช้ไปแล้ว" : "คูปองนี้หมดอายุแล้ว";
      return res.status(409).json({ message: reason, coupon });
    }

    return res.json({ message: `ใช้คูปองสำเร็จ — ให้ส่วนลด ${coupon.discountBaht} บาท`, coupon });
  } catch (err) {
    next(err);
  }
});

module.exports = { router, redeemCoupon, isRealCoupon, isUnsetCoupon };
