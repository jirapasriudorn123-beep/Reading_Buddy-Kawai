const express = require("express");
const db = require("../db/database");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const LOW_STAT_THRESHOLD = 25;
const STAT_LABELS = {
  hunger: "หิว",
  cleanliness: "ความสะอาด",
  happiness: "ความสุข",
  energy: "พลังงาน",
};

// ---------- GET /api/notifications ----------
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const notifications = [];

    // ---- 1) แจ้งเตือนอัปเดตเว็บ ----
    const user = await db.prepare("SELECT last_seen_update_at FROM users WHERE id = ?").get(req.user.id);
    const latestUpdateAtRow = await db.prepare("SELECT value FROM site_meta WHERE key = 'latest_update_at'").get();
    const latestUpdateMessageRow = await db.prepare("SELECT value FROM site_meta WHERE key = 'latest_update_message'").get();
    const latestUpdateAt = latestUpdateAtRow?.value;
    const latestUpdateMessage = latestUpdateMessageRow?.value;

    if (latestUpdateAt && (!user.last_seen_update_at || user.last_seen_update_at < latestUpdateAt)) {
      notifications.push({
        id: "update",
        type: "update",
        message: latestUpdateMessage || "เว็บมีการอัปเดตใหม่ล่าสุด",
        createdAt: latestUpdateAt,
      });
    }

    // ---- 2) สถานะน้องหมาต่ำกว่า 25% ----
    const pet = await db
      .prepare("SELECT name, hunger, cleanliness, happiness, energy FROM pets WHERE user_id = ?")
      .get(req.user.id);

    // id มีวันที่ (เวลาไทย) ด้วย — เตือนใหม่ได้วันละครั้งต่อค่าสถานะ ถ้าใช้ id ตายตัว เห็นครั้งเดียวแล้วจะไม่เด้งอีกเลย
    if (pet) {
      const thaiDay = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
      for (const stat of Object.keys(STAT_LABELS)) {
        if (pet[stat] < LOW_STAT_THRESHOLD) {
          notifications.push({
            id: `pet-${stat}-${thaiDay}`,
            type: "pet_low",
            message: `น้อง${pet.name}มีค่า${STAT_LABELS[stat]}ต่ำกว่า 25% แล้ว ไปดูแลน้องหน่อยนะ`,
            createdAt: null,
          });
        }
      }
    }

    // ---- 3) ประวัติการซื้อของล่าสุด ----
    const purchases = await db
      .prepare(
        `SELECT id, product_name, price, purchased_at
         FROM purchase_log
         WHERE user_id = ?
         ORDER BY purchased_at DESC
         LIMIT 5`
      )
      .all(req.user.id);

    purchases.forEach((p) => {
      notifications.push({
        id: `purchase-${p.id}`,
        type: "purchase",
        message: `คุณซื้อ ${p.product_name} ไปแล้ว (${p.price} คอยน์)`,
        createdAt: p.purchased_at,
      });
    });

    // เรียงใหม่ให้ของล่าสุดอยู่บนสุด — แจ้งเตือนที่ไม่มีเวลา (น้องหมาหิว/สกปรก) คือเรื่องที่เป็นอยู่ตอนนี้ จึงอยู่บนสุดเสมอ
    const NOW = "9999-99-99";
    notifications.sort((a, b) => String(b.createdAt || NOW).localeCompare(String(a.createdAt || NOW)));

    return res.json({ notifications, unreadCount: notifications.length });
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/notifications/feedback ----------
// ข้อความจากอาจารย์/แอดมินถึงนิสิตคนนี้ (ปุ่มจดหมายข้างกระดิ่ง) — แยกจากแจ้งเตือนทั่วไป
router.get("/feedback", requireAuth, async (req, res, next) => {
  try {
    const messages = await db
      .prepare(
        `SELECT id, message, datetime(created_at, '+7 hours') created_at
         FROM user_feedback WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`
      )
      .all(req.user.id);
    return res.json({ messages });
  } catch {
    return res.json({ messages: [] }); // ตารางยังไม่ถูกสร้าง (เซิร์ฟเวอร์ยังไม่ได้รีสตาร์ทหลังอัปเดต)
  }
});

// ---------- POST /api/notifications/mark-update-seen ----------
router.post("/mark-update-seen", requireAuth, async (req, res, next) => {
  try {
    await db.prepare("UPDATE users SET last_seen_update_at = datetime('now') WHERE id = ?").run(req.user.id);
    return res.json({ message: "ok" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
