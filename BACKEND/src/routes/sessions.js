const express = require("express");
const db = require("../db/database");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const COINS_PER_BLOCK = 10;
const READ_MINUTES_PER_BLOCK = 5;
const EXTEND_MINUTES = 5;
const MAX_READ_MINUTES = 120;
const AWAY_GRACE_SECONDS = 15;

// จำนวนวินาทีตั้งแต่เวลา datetime('now') ของ SQLite (UTC, ไม่มี timezone ต่อท้าย) จนถึงตอนนี้
function secondsSince(sqliteDatetime) {
  return Math.max(0, Math.floor((Date.now() - new Date(sqliteDatetime + "Z").getTime()) / 1000));
}

// ---------- POST /api/sessions/:sessionId/complete ----------
router.post("/:sessionId/complete", requireAuth, async (req, res) => {
  try {
    const sessionId = Number(req.params.sessionId);

    const session = await db
      .prepare(
        `SELECT rs.id, rs.user_id, rs.chapter_id, rs.planned_read_seconds, rs.status, rs.started_at,
                rs.away_seconds, rs.away_started_at, c.coin_reward, c.title AS chapter_title
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

    // หักเวลาที่ออกจากหน้าอ่าน (สลับแท็บ/ย่อหน้าต่าง) — รวมช่วงที่ยังออกค้างอยู่ตอนกดจบด้วย
    let awaySeconds = session.away_seconds || 0;
    if (session.away_started_at) {
      awaySeconds += secondsSince(session.away_started_at);
    }
    let readSeconds = Math.max(0, elapsedSeconds - awaySeconds);
    // เผื่อคลาดเคลื่อนเล็กน้อยจาก network/การปัดวินาที ตอนนับถอยหลังฝั่งหน้าเว็บหมดพอดี จะได้ไม่โดนปัดลงไปอีกขั้น
    if (readSeconds >= session.planned_read_seconds - AWAY_GRACE_SECONDS) {
      readSeconds = session.planned_read_seconds;
    }

    const effectiveElapsedSeconds = Math.min(readSeconds, session.planned_read_seconds);
    const effectiveElapsedMinutes = Math.floor(effectiveElapsedSeconds / 60);
    const coinsEarned = Math.floor(effectiveElapsedMinutes / READ_MINUTES_PER_BLOCK) * COINS_PER_BLOCK;
    const completedFullDuration = effectiveElapsedSeconds >= session.planned_read_seconds;

    // atomic guard: ปิดเซสชันได้เฉพาะถ้ายัง in_progress อยู่จริงตอน UPDATE
    // (กันกดจบซ้ำพร้อมกัน เช่น ดับเบิลคลิก/เปิดหลายแท็บ แล้วได้เหรียญซ้ำ)
    const closed = await db.tx(async (t) => {
      const result = await t.prepare(
        `UPDATE reading_sessions SET status = 'completed', ended_at = datetime('now'), coins_earned = ?, read_seconds = ?
         WHERE id = ? AND status = 'in_progress'`
      ).run(coinsEarned, effectiveElapsedSeconds, sessionId);
      if (result.changes === 0) return false;
      await t.prepare("UPDATE users SET coins = coins + ? WHERE id = ?").run(coinsEarned, req.user.id);
      return true;
    });
    if (!closed) {
      return res.status(400).json({ message: "เซสชันนี้จบไปแล้ว หรือถูกยกเลิกไปแล้ว" });
    }

    const user = await db.prepare("SELECT coins FROM users WHERE id = ?").get(req.user.id);

    return res.json({
      message: completedFullDuration
        ? "อ่านครบเวลาแล้ว! ได้รับเหรียญเต็มจำนวน"
        : "จบเซสชันก่อนครบเวลา ได้รับเหรียญตามจำนวนนาทีที่อ่านจริง",
      chapterTitle: session.chapter_title,
      elapsedSeconds,
      awaySeconds,
      plannedReadSeconds: session.planned_read_seconds,
      coinsEarned,
      totalCoins: user.coins,
    });
  } catch (err) {
    console.error("Complete reading session error:", err);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์" });
  }
});

// ---------- POST /api/sessions/:sessionId/away ----------
// หน้าเว็บเรียกตอนผู้ใช้ออกจากหน้าอ่าน (สลับแท็บ/ย่อหน้าต่าง) เริ่มจับเวลาที่ไม่นับเป็นเวลาอ่าน
router.post("/:sessionId/away", requireAuth, async (req, res, next) => {
  try {
    await db.prepare(
      `UPDATE reading_sessions SET away_started_at = datetime('now')
       WHERE id = ? AND user_id = ? AND status = 'in_progress' AND away_started_at IS NULL`
    ).run(Number(req.params.sessionId), req.user.id);
    return res.json({ message: "บันทึกเวลาออกจากหน้าอ่านแล้ว" });
  } catch (err) {
    next(err);
  }
});

// ---------- POST /api/sessions/:sessionId/back ----------
// กลับมาที่หน้าอ่าน: รวมช่วงที่ออกไปเข้า away_seconds แล้วเคลียร์ away_started_at
router.post("/:sessionId/back", requireAuth, async (req, res, next) => {
  try {
    const sessionId = Number(req.params.sessionId);
    const session = await db
      .prepare("SELECT user_id, status, away_seconds, away_started_at FROM reading_sessions WHERE id = ?")
      .get(sessionId);

    if (!session || session.user_id !== req.user.id) {
      return res.status(404).json({ message: "ไม่พบเซสชันการอ่านนี้" });
    }
    if (session.status !== "in_progress" || !session.away_started_at) {
      return res.json({ awaySeconds: 0, totalAwaySeconds: session.away_seconds });
    }

    const awaySeconds = secondsSince(session.away_started_at);
    // guard ด้วย away_started_at เดิม กันเรียก back ซ้อนกันแล้วบวกช่วงเดียวกันสองรอบ
    const result = await db.prepare(
      `UPDATE reading_sessions SET away_seconds = away_seconds + ?, away_started_at = NULL
       WHERE id = ? AND away_started_at = ?`
    ).run(awaySeconds, sessionId, session.away_started_at);

    const added = result.changes === 0 ? 0 : awaySeconds;
    return res.json({ awaySeconds: added, totalAwaySeconds: session.away_seconds + added });
  } catch (err) {
    next(err);
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
