const express = require("express");
const db = require("../db/database");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const MAX_MINUTES = 120;
const MAX_SECONDS = 59;
const MIN_READ_MINUTES = 10;

function toSeconds(minutes, seconds) {
  return Number(minutes) * 60 + Number(seconds);
}

// ---------- GET /api/chapters ----------
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const chapters = await db
      .prepare("SELECT id, chapter_number, title, coin_reward, detail, image_url, pdf_url FROM chapters ORDER BY chapter_number ASC")
      .all();

    return res.json({ chapters });
  } catch (err) {
    next(err);
  }
});

// ---------- POST /api/chapters/:chapterId/sessions ----------
router.post("/:chapterId/sessions", requireAuth, async (req, res) => {
  try {
    const chapterId = Number(req.params.chapterId);
    let { readMinutes, readSeconds, breakMinutes, breakSeconds } = req.body;

    readMinutes = Number(readMinutes);
    readSeconds = Number(readSeconds);
    breakMinutes = Number(breakMinutes) || 0;
    breakSeconds = Number(breakSeconds) || 0;

    const chapter = await db.prepare("SELECT id, title, coin_reward FROM chapters WHERE id = ?").get(chapterId);
    if (!chapter) {
      return res.status(404).json({ message: "ไม่พบ Chapter นี้" });
    }

    // ---- กันเปิดหลายเซสชันพร้อมกัน ----
    const existingSession = await db
      .prepare("SELECT id FROM reading_sessions WHERE user_id = ? AND status = 'in_progress'")
      .get(req.user.id);
    if (existingSession) {
      return res.status(409).json({
        message: "คุณมีเซสชันการอ่านที่ยังไม่จบอยู่แล้ว (อาจเปิดค้างไว้ในแท็บหรือหน้าต่างอื่น) กรุณาจบหรือยกเลิกก่อนเริ่มใหม่",
      });
    }

    // ---- validate เวลา ----
    for (const [label, m, s] of [
      ["เวลาอ่าน", readMinutes, readSeconds],
      ["เวลาพัก", breakMinutes, breakSeconds],
    ]) {
      if (!Number.isInteger(m) || !Number.isInteger(s)) {
        return res.status(400).json({ message: `กรุณากรอก${label}เป็นตัวเลข` });
      }
      if (m < 0 || m > MAX_MINUTES || s < 0 || s > MAX_SECONDS || (m === MAX_MINUTES && s > 0)) {
        return res.status(400).json({ message: `${label}ต้องอยู่ระหว่าง 0:00 ถึง ${MAX_MINUTES}:00` });
      }
    }

    const plannedReadSeconds = toSeconds(readMinutes, readSeconds);
    if (plannedReadSeconds < MIN_READ_MINUTES * 60) {
      return res.status(400).json({ message: `เวลาอ่านต้องตั้งอย่างน้อย ${MIN_READ_MINUTES} นาที` });
    }
    const plannedBreakSeconds = toSeconds(breakMinutes, breakSeconds);

    const result = await db
      .prepare(
        `INSERT INTO reading_sessions (user_id, chapter_id, planned_read_seconds, planned_break_seconds, status)
         VALUES (?, ?, ?, ?, 'in_progress')`
      )
      .run(req.user.id, chapterId, plannedReadSeconds, plannedBreakSeconds);

    return res.status(201).json({
      message: "เริ่มจับเวลาอ่านแล้ว",
      session: {
        id: result.lastInsertRowid,
        chapterId,
        chapterTitle: chapter.title,
        plannedReadSeconds,
        plannedBreakSeconds,
      },
    });
  } catch (err) {
    console.error("Start reading session error:", err);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์" });
  }
});

module.exports = router;
