const express = require("express");
const db = require("../db/database");
const { requireAuth } = require("../middleware/auth");
const { getReadingRules } = require("../services/readingRules");

const router = express.Router();

const MAX_MINUTES = 120;
const MAX_SECONDS = 59;
const QUIZ_QUESTIONS_PER_SESSION = 3; // แบบทดสอบก่อน/หลังอ่าน รอบละ 3 ข้อ

function toSeconds(minutes, seconds) {
  return Number(minutes) * 60 + Number(seconds);
}

// ---------- GET /api/chapters ----------
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const chapters = await db
      .prepare("SELECT id, chapter_number, title, coin_reward, detail, image_url, pdf_url FROM chapters ORDER BY chapter_number ASC")
      .all();

    // กติกาเวลาอ่านตอนนี้ (หน้าเว็บใช้ตั้งค่าเริ่มต้นในกล่องตั้งเวลา และบอกผู้ใช้ตอนเปิดโหมดสาธิต)
    const readingRules = await getReadingRules();
    return res.json({ chapters, readingRules });
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

    const rules = await getReadingRules();
    const plannedReadSeconds = toSeconds(readMinutes, readSeconds);
    if (plannedReadSeconds < rules.minReadMinutes * 60) {
      return res.status(400).json({ message: `เวลาอ่านต้องตั้งอย่างน้อย ${rules.minReadMinutes} นาที` });
    }
    const plannedBreakSeconds = toSeconds(breakMinutes, breakSeconds);

    // ---- แบบทดสอบก่อนอ่าน: สุ่มคำถามของบทนี้ (ชุดเดียวกับมินิเกม) ข้อเดิมจะถูกถามซ้ำหลังอ่าน ----
    // บทที่ยังไม่มีคำถามเลย ข้ามแบบทดสอบไปเริ่มอ่านทันที (แอดมินควรเพิ่มคำถามให้ครบทุกบท)
    const questions = await db
      .prepare(
        `SELECT id, question, option_1, option_2, option_3, option_4
         FROM quiz_questions WHERE chapter_id = ? AND enabled = 1
         ORDER BY RANDOM() LIMIT ?`
      )
      .all(chapterId, QUIZ_QUESTIONS_PER_SESSION);
    const status = questions.length > 0 ? "pre_test" : "in_progress";

    // ---- เซสชันเก่าที่ค้างอยู่ (รีเฟรช/ปิดหน้าระหว่างทำแบบทดสอบหรืออ่าน หน้าเว็บเลยไม่รู้จักแล้ว จบหรือยกเลิกเองไม่ได้) ----
    // ยกเลิกทิ้งแล้วเริ่มอันใหม่แทน (ไม่ให้เหรียญของอันเก่า กันเปิดค้างไว้เฉยๆ แล้วมาเก็บเหรียญทีหลัง)
    const result = await db.tx(async (t) => {
      await t.prepare(
        `UPDATE reading_sessions SET status = 'cancelled', ended_at = datetime('now')
         WHERE user_id = ? AND status IN ('pre_test', 'in_progress', 'post_test')`
      ).run(req.user.id);
      const inserted = await t.prepare(
        `INSERT INTO reading_sessions
           (user_id, chapter_id, planned_read_seconds, planned_break_seconds, status, minutes_per_block, quiz_total)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(req.user.id, chapterId, plannedReadSeconds, plannedBreakSeconds, status, rules.minutesPerBlock, questions.length);
      for (const [i, q] of questions.entries()) {
        await t.prepare(
          "INSERT INTO reading_session_questions (session_id, position, question_id) VALUES (?, ?, ?)"
        ).run(inserted.lastInsertRowid, i + 1, q.id);
      }
      return inserted;
    });

    return res.status(201).json({
      message: status === "pre_test" ? "ทำแบบทดสอบก่อนอ่าน แล้วเริ่มจับเวลาอ่าน" : "เริ่มจับเวลาอ่านแล้ว",
      session: {
        id: result.lastInsertRowid,
        chapterId,
        chapterTitle: chapter.title,
        plannedReadSeconds,
        plannedBreakSeconds,
        status,
      },
      // ไม่ส่งเฉลยมา — server ตรวจเองตอนส่งคำตอบ
      preTest: questions.map((q, i) => ({
        position: i + 1,
        question: q.question,
        options: [q.option_1, q.option_2, q.option_3, q.option_4],
      })),
    });
  } catch (err) {
    console.error("Start reading session error:", err);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์" });
  }
});

module.exports = router;
