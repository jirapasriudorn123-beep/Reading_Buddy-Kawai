const express = require("express");
const db = require("../db/database");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const MAX_MINUTES = 120;
const MAX_SECONDS = 59;

// ---------- GET /api/goal ----------
// ดึงเป้าหมายเวลาอ่านของผู้ใช้ปัจจุบัน (ถ้ายังไม่เคยตั้งจะได้ 0:00)
router.get("/", requireAuth, (req, res) => {
  const goal = db
    .prepare("SELECT goal_minutes, goal_seconds, updated_at FROM reading_goals WHERE user_id = ?")
    .get(req.user.id);

  return res.json({
    goal: goal || { goal_minutes: 0, goal_seconds: 0, updated_at: null },
  });
});

// ---------- PUT /api/goal ----------
// ตั้ง/แก้ไขเป้าหมายเวลาอ่าน
router.put("/", requireAuth, (req, res) => {
  try {
    let { minutes, seconds } = req.body;
    minutes = Number(minutes);
    seconds = Number(seconds);

    if (!Number.isInteger(minutes) || !Number.isInteger(seconds)) {
      return res.status(400).json({ message: "กรุณากรอกนาทีและวินาทีเป็นตัวเลข" });
    }
    if (minutes < 0 || minutes > MAX_MINUTES) {
      return res.status(400).json({ message: `นาทีต้องอยู่ระหว่าง 0-${MAX_MINUTES}` });
    }
    if (seconds < 0 || seconds > MAX_SECONDS) {
      return res.status(400).json({ message: `วินาทีต้องอยู่ระหว่าง 0-${MAX_SECONDS}` });
    }
    if (minutes === 0 && seconds === 0) {
      return res.status(400).json({ message: "กรุณาตั้งเป้าหมายเวลามากกว่า 0" });
    }
    // กันกรณีตั้ง 120:01 ขึ้นไป (โจทย์บอกสูงสุด 120 นาที 00 วินาที)
    if (minutes === MAX_MINUTES && seconds > 0) {
      return res.status(400).json({ message: `ตั้งได้สูงสุด ${MAX_MINUTES} นาที 00 วินาที` });
    }

    db.prepare(
      `INSERT INTO reading_goals (user_id, goal_minutes, goal_seconds, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         goal_minutes = excluded.goal_minutes,
         goal_seconds = excluded.goal_seconds,
         updated_at = excluded.updated_at`
    ).run(req.user.id, minutes, seconds);

    return res.json({
      message: "ตั้งเป้าหมายเวลาอ่านสำเร็จ",
      goal: { goal_minutes: minutes, goal_seconds: seconds },
    });
  } catch (err) {
    console.error("Set reading goal error:", err);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์" });
  }
});

module.exports = router;
