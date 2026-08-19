const express = require("express");
const db = require("../db/database");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const COINS_PER_BLOCK = 10;
const READ_MINUTES_PER_BLOCK = 5;
const EXTEND_MINUTES = 5;
const MAX_READ_MINUTES = 120;

// ---------- POST /api/sessions/:sessionId/complete ----------
router.post("/:sessionId/complete", requireAuth, async (req, res) => {
  try {
    const sessionId = Number(req.params.sessionId);

    const session = await db
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

    const startedAtMs = new Date(session.started_at + "Z").getTime();
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));

    const effectiveElapsedSeconds = Math.min(elapsedSeconds, session.planned_read_seconds);
    const effectiveElapsedMinutes = Math.floor(effectiveElapsedSeconds / 60);
    const coinsEarned = Math.floor(effectiveElapsedMinutes / READ_MINUTES_PER_BLOCK) * COINS_PER_BLOCK;
    const completedFullDuration = effectiveElapsedSeconds >= session.planned_read_seconds;

    await db.tx(async (t) => {
      await t.prepare(
        `UPDATE reading_sessions SET status = 'completed', ended_at = datetime('now'), coins_earned = ?
         WHERE id = ?`
      ).run(coinsEarned, sessionId);
      await t.prepare("UPDATE users SET coins = coins + ? WHERE id = ?").run(coinsEarned, req.user.id);
    });

    const user = await db.prepare("SELECT coins FROM users WHERE id = ?").get(req.user.id);

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
router.post("/:sessionId/extend", requireAuth, async (req, res, next) => {
  try {
    const sessionId = Number(req.params.sessionId);

    const session = await db
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

    await db.prepare("UPDATE reading_sessions SET planned_read_seconds = ? WHERE id = ?").run(newPlannedSeconds, sessionId);

    return res.json({
      message: `เพิ่มเวลาอ่านอีก ${Math.floor(addedSeconds / 60)} นาที`,
      plannedReadSeconds: newPlannedSeconds,
      addedSeconds,
    });
  } catch (err) {
    next(err);
  }
});

// ---------- POST /api/sessions/:sessionId/cancel ----------
router.post("/:sessionId/cancel", requireAuth, async (req, res, next) => {
  try {
    const sessionId = Number(req.params.sessionId);

    const session = await db
      .prepare("SELECT id, user_id, status FROM reading_sessions WHERE id = ?")
      .get(sessionId);

    if (!session || session.user_id !== req.user.id) {
      return res.status(404).json({ message: "ไม่พบเซสชันการอ่านนี้" });
    }
    if (session.status !== "in_progress") {
      return res.status(400).json({ message: "เซสชันนี้จบไปแล้ว หรือถูกยกเลิกไปแล้ว" });
    }

    await db.prepare(
      "UPDATE reading_sessions SET status = 'cancelled', ended_at = datetime('now') WHERE id = ?"
    ).run(sessionId);

    return res.json({ message: "ยกเลิกเซสชันการอ่านแล้ว" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
