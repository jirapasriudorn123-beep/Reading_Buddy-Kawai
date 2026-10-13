const express = require("express");
const db = require("../db/database");
const { requireAuth } = require("../middleware/auth");
const { getReadingRules, dailyTimeCoinCap, coinsPerRound, timeCoinsToday } = require("../services/readingRules");
const tests = require("../services/chapterTests");

const router = express.Router();

// สถานะคอยน์จากเวลาอ่านวันนี้ (นับเป็นรอบละ 25 นาที) — null = ไม่จำกัด (โหมดสาธิต)
async function dailyRoundsStatus(userId, rules) {
  const cap = dailyTimeCoinCap(rules);
  if (cap === null) return { roundsUsed: null, roundsCap: null };
  const used = await timeCoinsToday(userId);
  return { roundsUsed: Math.min(rules.dailyCoinRounds, Math.floor(used / coinsPerRound(rules))), roundsCap: rules.dailyCoinRounds };
}

// ---------- GET /api/chapters ----------
// บทเรียนทั้งหมด + สถานะการอ่าน/แบบทดสอบของผู้ใช้ในแต่ละบท + กติกาเวลาอ่าน (รอบ Pomodoro ที่เลือกได้)
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const chapters = await db
      .prepare("SELECT id, chapter_number, title, coin_reward, detail, image_url, pdf_url FROM chapters ORDER BY chapter_number ASC")
      .all();
    const readingRules = await getReadingRules();
    const [progress, daily] = await Promise.all([
      Promise.all(chapters.map((c) => tests.chapterProgress(req.user.id, c.id))),
      dailyRoundsStatus(req.user.id, readingRules),
    ]);

    return res.json({
      chapters: chapters.map((c, i) => ({ ...c, progress: progress[i] })),
      readingRules: { ...readingRules, ...daily },
    });
  } catch (err) {
    next(err);
  }
});

// ---------- POST /api/chapters/:chapterId/sessions ----------
// เริ่มอ่าน 1 รอบ Pomodoro — body: { presetId } ("25" = อ่าน 25 พัก 5 | โหมดสาธิต "demo1" = อ่าน 1 พัก 1)
// บทที่ยังไม่ได้ทำแบบทดสอบก่อนอ่าน ตอบ 409 PRE_TEST_REQUIRED ให้หน้าเว็บพาไปทำก่อน
router.post("/:chapterId/sessions", requireAuth, async (req, res) => {
  try {
    const chapterId = Number(req.params.chapterId);
    const chapter = await db.prepare("SELECT id, title FROM chapters WHERE id = ?").get(chapterId);
    if (!chapter) {
      return res.status(404).json({ message: "ไม่พบ Chapter นี้" });
    }

    const rules = await getReadingRules();
    const preset = rules.presets.find((p) => p.id === String(req.body.presetId));
    if (!preset) {
      return res.status(400).json({ message: "กรุณาเลือกรอบเวลาอ่าน" });
    }

    const test = await tests.getOrCreateActiveTest(req.user.id, chapterId);
    if (test.status === "pre_test") {
      return res.status(409).json({ code: "PRE_TEST_REQUIRED", message: "ทำแบบทดสอบก่อนอ่านบทนี้ก่อนนะ" });
    }
    if (test.status === "post_test") {
      return res.status(409).json({ code: "POST_TEST_IN_PROGRESS", message: "ทำแบบทดสอบหลังอ่านบทนี้ให้เสร็จก่อนนะ" });
    }

    const plannedReadSeconds = preset.readMinutes * 60;
    const plannedBreakSeconds = preset.breakMinutes * 60;

    // ---- เซสชันเก่าที่ค้าง in_progress (รีเฟรช/ปิดหน้าระหว่างอ่าน หน้าเว็บเลยไม่รู้จักแล้ว จบหรือยกเลิกเองไม่ได้) ----
    // ยกเลิกทิ้งแล้วเริ่มอันใหม่แทน (ไม่ให้เหรียญของอันเก่า กันเปิดค้างไว้เฉยๆ แล้วมาเก็บเหรียญทีหลัง)
    const result = await db.tx(async (t) => {
      await t.prepare(
        `UPDATE reading_sessions SET status = 'cancelled', ended_at = datetime('now')
         WHERE user_id = ? AND status = 'in_progress'`
      ).run(req.user.id);
      return t.prepare(
        `INSERT INTO reading_sessions
           (user_id, chapter_id, planned_read_seconds, planned_break_seconds, status, minutes_per_block, chapter_test_id)
         VALUES (?, ?, ?, ?, 'in_progress', ?, ?)`
      ).run(req.user.id, chapterId, plannedReadSeconds, plannedBreakSeconds, rules.minutesPerBlock, test.id);
    });

    // อ่านต่อจากหน้าที่เปิดค้างไว้ครั้งก่อนของบทนี้ (ตัวแสดง PDF จะเปิดที่หน้านี้)
    const last = await db
      .prepare(
        `SELECT last_page FROM reading_sessions
         WHERE user_id = ? AND chapter_id = ? AND last_page IS NOT NULL AND id != ?
         ORDER BY id DESC LIMIT 1`
      )
      .get(req.user.id, chapterId, result.lastInsertRowid);

    return res.status(201).json({
      message: "เริ่มจับเวลาอ่านแล้ว",
      session: {
        id: result.lastInsertRowid,
        chapterId,
        chapterTitle: chapter.title,
        plannedReadSeconds,
        plannedBreakSeconds,
        resumePage: last ? last.last_page : null,
      },
    });
  } catch (err) {
    console.error("Start reading session error:", err);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์" });
  }
});

// ================== แบบทดสอบก่อนอ่าน/หลังอ่าน รายบท (ถามทีละข้อ ข้อละ 1 นาที) ==================

// ---------- POST /api/chapters/:chapterId/test/next ----------
// ข้อถัดไปของแบบทดสอบที่ต้องทำตอนนี้ — body: { phase: "pre" | "post" }
// pre: ถ้ายังไม่เคยเริ่มบทนี้จะสร้างชุดแบบทดสอบให้ | post: เริ่ม post ได้เมื่ออ่านบทนี้ครบเวลาขั้นต่ำแล้ว
// คืน { phase, question } หรือ { phase, done: true, summary }
router.post("/:chapterId/test/next", requireAuth, async (req, res, next) => {
  try {
    const chapterId = Number(req.params.chapterId);
    const chapter = await db.prepare("SELECT id FROM chapters WHERE id = ?").get(chapterId);
    if (!chapter) return res.status(404).json({ message: "ไม่พบ Chapter นี้" });

    const phase = req.body.phase;
    let test;
    if (phase === "pre") {
      test = await tests.getOrCreateActiveTest(req.user.id, chapterId);
      if (test.status !== "pre_test") {
        return res.json({ phase: "pre", done: true, summary: { phase: "pre", preScore: test.pre_score, total: test.total } });
      }
    } else if (phase === "post") {
      const started = await tests.startPostTest(req.user.id, chapterId);
      if (started.error) return res.status(started.error.status).json({ message: started.error.message });
      test = started.test;
    } else {
      return res.status(400).json({ message: "phase ไม่ถูกต้อง" });
    }

    return res.json(await tests.serveNext(req.user.id, test));
  } catch (err) {
    next(err);
  }
});

// ---------- POST /api/chapters/:chapterId/test/answer ----------
// ตอบข้อที่กำลังถามอยู่ — body: { phase, picked (0-4), tabSwitched }
// picked 0: ก่อนอ่าน = "ยังไม่รู้" / หลังอ่าน = หมดเวลา | หลังอ่านสลับแท็บระหว่างข้อ = ข้อนั้นผิด
router.post("/:chapterId/test/answer", requireAuth, async (req, res, next) => {
  try {
    const chapterId = Number(req.params.chapterId);
    const picked = Number(req.body.picked);
    if (!Number.isInteger(picked) || picked < 0 || picked > 4) {
      return res.status(400).json({ message: "คำตอบไม่ถูกต้อง" });
    }

    const test = await tests.getLatestTest(req.user.id, chapterId);
    const phase = test ? tests.phaseOf(test) : null;
    if (!phase || phase !== req.body.phase) {
      return res.status(400).json({ message: "ไม่มีแบบทดสอบที่รอตอบอยู่ ลองเปิดบทนี้ใหม่อีกครั้งนะ" });
    }

    return res.json(await tests.answerCurrent(req.user.id, test, picked, !!req.body.tabSwitched));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
