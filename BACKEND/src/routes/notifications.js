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
// รวม 3 ประเภทแจ้งเตือน: (1) เว็บมีอัปเดตใหม่ (2) สถานะน้องหมาต่ำกว่า 25% (3) ประวัติการซื้อของล่าสุด
router.get("/", requireAuth, (req, res) => {
  const notifications = [];

  // ---- 1) แจ้งเตือนอัปเดตเว็บ (แสดงจนกว่าผู้ใช้จะเปิดดู แล้วค่อย mark ว่าเห็นแล้ว) ----
  const user = db.prepare("SELECT last_seen_update_at FROM users WHERE id = ?").get(req.user.id);
  const latestUpdateAt = db.prepare("SELECT value FROM site_meta WHERE key = 'latest_update_at'").get()?.value;
  const latestUpdateMessage = db.prepare("SELECT value FROM site_meta WHERE key = 'latest_update_message'").get()?.value;

  if (latestUpdateAt && (!user.last_seen_update_at || user.last_seen_update_at < latestUpdateAt)) {
    notifications.push({
      id: "update",
      type: "update",
      message: latestUpdateMessage || "เว็บมีการอัปเดตใหม่ล่าสุด",
      createdAt: latestUpdateAt,
    });
  }

  // ---- 2) สถานะน้องหมาต่ำกว่า 25% ----
  const pet = db
    .prepare("SELECT name, hunger, cleanliness, happiness, energy FROM pets WHERE user_id = ?")
    .get(req.user.id);

  if (pet) {
    for (const stat of Object.keys(STAT_LABELS)) {
      if (pet[stat] < LOW_STAT_THRESHOLD) {
        notifications.push({
          id: `pet-${stat}`,
          type: "pet_low",
          message: `น้อง${pet.name}มีค่า${STAT_LABELS[stat]}ต่ำกว่า 25% แล้ว ไปดูแลน้องหน่อยนะ`,
          createdAt: null,
        });
      }
    }
  }

  // ---- 3) ประวัติการซื้อของล่าสุด (5 รายการล่าสุด) ----
  const purchases = db
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

  return res.json({ notifications, unreadCount: notifications.length });
});

// ---------- POST /api/notifications/mark-update-seen ----------
// เรียกตอนผู้ใช้เปิดดูกระดิ่งแจ้งเตือน เพื่อไม่ให้แจ้งเตือน "มีอัปเดตใหม่" ค้างตลอดไป
router.post("/mark-update-seen", requireAuth, (req, res) => {
  db.prepare("UPDATE users SET last_seen_update_at = datetime('now') WHERE id = ?").run(req.user.id);
  return res.json({ message: "ok" });
});

module.exports = router;
