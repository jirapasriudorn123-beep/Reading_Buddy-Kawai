const express = require("express");
const db = require("../db/database");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const COINS_PER_BLOCK = 10; // ให้เหรียญเป็นก้อนๆ ทุกๆ READ_MINUTES_PER_BLOCK นาทีที่อ่านจริง (ไม่ปัดเศษนาทีที่อ่านไม่ครบบล็อก)
const READ_MINUTES_PER_BLOCK = 5;
const EXTEND_MINUTES = 5;
const MAX_READ_MINUTES = 120;

// ---------- POST /api/sessions/:sessionId/complete ----------
// จบเซสชันการอ่าน คำนวณเวลาที่อ่านจริงฝั่ง server (ไม่เชื่อเวลาที่ client ส่งมา กันโกง)
// ให้เหรียญ 10 เหรียญ ต่อทุกๆ 5 นาทีที่อ่านจริง (ไม่เกินเวลาที่ตั้งไว้) อ่านไม่ครบ 5 นาทีในบล็อกไหนจะไม่ได้เหรียญของบล็อกนั้น
router.post("/:sessionId/complete", requireAuth, (req, res) => {
  try {
    const sessionId = Number(req.params.sessionId);

    const session = db
      .prepare(
        `SELECT rs.id, rs.user_id, rs.chapter_id, rs.planned_read_seconds, rs.status, rs.started_at,
                c.coin_reward, c.title AS chapter_title
         FROM reading_sessions rs
         JOIN chapters c ON c.id = rs.chapter_id
         WHERE rs.id = ?`
      )
      .get(sessionId);

    if (!session || session.user_id !== req.user.id) {
      return res.status(404).json({ message: "ไม่พบเซสชันการอ่านนี้" });
    }
    if (session.status !== "in_progress") {
      return res.status(400).json({ message: "เซสชันนี้จบไปแล้ว หรือถูกยกเลิกไปแล้ว" });
    }

    // ---- คำนวณเวลาที่อ่านจริงจากเวลาฝั่ง server เท่านั้น ----
    const startedAtMs = new Date(session.started_at + "Z").getTime(); // datetime('now') ของ sqlite เป็น UTC
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));

    const effectiveElapsedSeconds = Math.min(elapsedSeconds, session.planned_read_seconds);
    const effectiveElapsedMinutes = Math.floor(effectiveElapsedSeconds / 60);
    const coinsEarned = Math.floor(effectiveElapsedMinutes / READ_MINUTES_PER_BLOCK) * COINS_PER_BLOCK;
    const completedFullDuration = effectiveElapsedSeconds >= session.planned_read_seconds;

    const updateSession = db.prepare(
      `UPDATE reading_sessions SET status = 'completed', ended_at = datetime('now'), coins_earned = ?
       WHERE id = ?`
    );
    const updateCoins = db.prepare("UPDATE users SET coins = coins + ? WHERE id = ?");

    const runInTransaction = db.transaction(() => {
      updateSession.run(coinsEarned, sessionId);
      updateCoins.run(coinsEarned, req.user.id);
    });
    runInTransaction();

    const user = db.prepare("SELECT coins FROM users WHERE id = ?").get(req.user.id);

    return res.json({
      message: completedFullDuration
        ? "อ่านครบเวลาแล้ว! ได้รับเหรียญเต็มจำนวน"
        : "จบเซสชันก่อนครบเวลา ได้รับเหรียญตามจำนวนนาทีที่อ่านจริง",
      chapterTitle: session.chapter_title,
      elapsedSeconds,
      plannedReadSeconds: session.planned_read_seconds,
      coinsEarned,
      totalCoins: user.coins,
    });
  } catch (err) {
    console.error("Complete reading session error:", err);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์" });
  }
});

// ---------- POST /api/sessions/:sessionId/extend ----------
// เพิ่มเวลาอ่านทีละ 5 นาทีระหว่างกำลังอ่านอยู่จริง (ปุ่ม "+5" หน้าอ่าน PDF) รวมแล้วไม่เกิน MAX_READ_MINUTES
router.post("/:sessionId/extend", requireAuth, (req, res) => {
  const sessionId = Number(req.params.sessionId);

  const session = db
    .prepare("SELECT id, user_id, status, planned_read_seconds FROM reading_sessions WHERE id = ?")
    .get(sessionId);

  if (!session || session.user_id !== req.user.id) {
    return res.status(404).json({ message: "ไม่พบเซสชันการอ่านนี้" });
  }
  if (session.status !== "in_progress") {
    return res.status(400).json({ message: "เซสชันนี้จบไปแล้ว หรือถูกยกเลิกไปแล้ว" });
  }

  const maxSeconds = MAX_READ_MINUTES * 60;
  const newPlannedSeconds = Math.min(maxSeconds, session.planned_read_seconds + EXTEND_MINUTES * 60);
  const addedSeconds = newPlannedSeconds - session.planned_read_seconds;

  if (addedSeconds <= 0) {
    return res.status(400).json({ message: `เวลาอ่านสูงสุดคือ ${MAX_READ_MINUTES} นาทีแล้ว` });
  }

  db.prepare("UPDATE reading_sessions SET planned_read_seconds = ? WHERE id = ?").run(newPlannedSeconds, sessionId);

  return res.json({
    message: `เพิ่มเวลาอ่านอีก ${Math.floor(addedSeconds / 60)} นาที`,
    plannedReadSeconds: newPlannedSeconds,
    addedSeconds,
  });
});

// ---------- POST /api/sessions/:sessionId/cancel ----------
// ยกเลิกเซสชันการอ่าน (ไม่ได้เหรียญ)
router.post("/:sessionId/cancel", requireAuth, (req, res) => {
  const sessionId = Number(req.params.sessionId);

  const session = db
    .prepare("SELECT id, user_id, status FROM reading_sessions WHERE id = ?")
    .get(sessionId);

  if (!session || session.user_id !== req.user.id) {
    return res.status(404).json({ message: "ไม่พบเซสชันการอ่านนี้" });
  }
  if (session.status !== "in_progress") {
    return res.status(400).json({ message: "เซสชันนี้จบไปแล้ว หรือถูกยกเลิกไปแล้ว" });
  }

  db.prepare(
    "UPDATE reading_sessions SET status = 'cancelled', ended_at = datetime('now') WHERE id = ?"
  ).run(sessionId);

  return res.json({ message: "ยกเลิกเซสชันการอ่านแล้ว" });
});

module.exports = router;
