const express = require("express");
const db = require("../db/database");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// จำนวนเวิลด์ทั้งหมด และจำนวนด่านต่อเวิลด์ของ Phayao Adventure
// (ต้องตรงกับฝั่ง FRONTEND/stage-select.js)
const TOTAL_WORLDS = 6;
const STAGES_PER_WORLD = 4;

async function getOrCreateProgress(userId) {
  let row = await db.prepare("SELECT * FROM game_progress WHERE user_id = ?").get(userId);
  if (!row) {
    await db.prepare("INSERT INTO game_progress (user_id, unlocked_world, unlocked_stage) VALUES (?, 1, 1)").run(userId);
    row = await db.prepare("SELECT * FROM game_progress WHERE user_id = ?").get(userId);
  }
  return row;
}

// ---------- GET /api/game/progress ----------
router.get("/progress", requireAuth, async (req, res, next) => {
  try {
    const progress = await getOrCreateProgress(req.user.id);
    return res.json({
      unlockedWorld: progress.unlocked_world,
      unlockedStage: progress.unlocked_stage,
      totalWorlds: TOTAL_WORLDS,
      stagesPerWorld: STAGES_PER_WORLD,
    });
  } catch (err) {
    next(err);
  }
});

// ---------- POST /api/game/progress/complete ----------
router.post("/progress/complete", requireAuth, async (req, res, next) => {
  try {
    const { world, stage } = req.body;

    if (!Number.isInteger(world) || !Number.isInteger(stage)) {
      return res.status(400).json({ message: "world/stage ต้องเป็นตัวเลข" });
    }

    const progress = await getOrCreateProgress(req.user.id);

    if (world !== progress.unlocked_world || stage !== progress.unlocked_stage) {
      return res.status(400).json({ message: "ด่านนี้ยังไม่ปลดล็อค หรือเล่นจบไปแล้ว" });
    }

    let nextWorld = progress.unlocked_world;
    let nextStage = progress.unlocked_stage + 1;
    if (nextStage > STAGES_PER_WORLD) {
      nextStage = 1;
      nextWorld = Math.min(TOTAL_WORLDS, progress.unlocked_world + 1);
    }

    await db.prepare(
      "UPDATE game_progress SET unlocked_world = ?, unlocked_stage = ?, updated_at = datetime('now') WHERE user_id = ?"
    ).run(nextWorld, nextStage, req.user.id);

    return res.json({
      unlockedWorld: nextWorld,
      unlockedStage: nextStage,
      totalWorlds: TOTAL_WORLDS,
      stagesPerWorld: STAGES_PER_WORLD,
    });
  } catch (err) {
    next(err);
  }
});

// ================== ตรวจคำตอบ + log (ใช้คิด % คะแนนที่หน้าแอดมิน "จัดการคะแนน") ==================
// server เป็นคนตรวจเอง (หน้าเว็บไม่ได้รับเฉลยล่วงหน้า) กันเปิด DevTools ดูเฉลย/ปลอมคะแนน
// source: 'chapter' (quiz_questions → หมวด subject) | 'breed' (breed_quiz_questions → หมวด dog)
const ANSWER_SOURCES = {
  chapter: { table: "quiz_questions", category: "subject" },
  breed: { table: "breed_quiz_questions", category: "dog" },
};

router.post("/answer", requireAuth, async (req, res, next) => {
  try {
    const { source, questionId, picked } = req.body;
    const src = ANSWER_SOURCES[source];
    if (!src) {
      return res.status(400).json({ message: "source ต้องเป็น chapter หรือ breed" });
    }
    if (!Number.isInteger(questionId) || !Number.isInteger(picked) || picked < 1 || picked > 4) {
      return res.status(400).json({ message: "questionId/picked ไม่ถูกต้อง" });
    }

    const question = await db
      .prepare(`SELECT correct_option FROM ${src.table} WHERE id = ? AND enabled = 1`)
      .get(questionId);
    if (!question) {
      return res.status(404).json({ message: "ไม่พบคำถามนี้" });
    }

    const correct = picked === question.correct_option;
    await db
      .prepare("INSERT INTO quiz_answer_log (user_id, category, correct) VALUES (?, ?, ?)")
      .run(req.user.id, src.category, correct ? 1 : 0);
    // เฉลยส่งกลับไปหลังตอบแล้วเท่านั้น (ไว้ไฮไลต์ข้อที่ถูกบนหน้าจอ)
    return res.json({ correct, correctOption: question.correct_option });
  } catch (err) {
    next(err);
  }
});

// ================== คำถามควิซที่ใช้เล่นจริง (ดึงจากที่แอดมินตั้งไว้) ==================
// ด่าน 1,3,5 ของแต่ละโลก = คำถามของบทเรียนนั้น (quiz_questions)
router.get("/quiz/chapter/:chapterNumber", requireAuth, async (req, res, next) => {
  try {
    const chapterNumber = Number(req.params.chapterNumber);
    const chapter = await db.prepare("SELECT id FROM chapters WHERE chapter_number = ?").get(chapterNumber);
    if (!chapter) return res.json({ questions: [] });

    const questions = await db
      .prepare(
        `SELECT id, question, option_1, option_2, option_3, option_4
         FROM quiz_questions WHERE chapter_id = ? AND enabled = 1 ORDER BY id ASC`
      )
      .all(chapter.id);
    return res.json({ questions });
  } catch (err) {
    next(err);
  }
});

// ด่าน 2,4 ของทุกโลก = คำถามพันธุ์สุนัขที่ผู้เล่นเลือก (breed_quiz_questions)
router.get("/quiz/breed/:breed", requireAuth, async (req, res, next) => {
  try {
    const questions = await db
      .prepare(
        `SELECT id, question, option_1, option_2, option_3, option_4
         FROM breed_quiz_questions WHERE breed = ? AND enabled = 1 ORDER BY id ASC`
      )
      .all(req.params.breed);
    return res.json({ questions });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
