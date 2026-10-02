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

// ================== การต่อสู้ (ควิซ) + โบนัสเหรียญ ==================
// ต้องตรงกับฝั่ง FRONTEND/game.js (ENEMY_MAX_HP, PLAYER_MAX_HEARTS, BATTLE_SECONDS, STAGES_PER_WORLD)
const BATTLE_MAX_QUESTIONS = 10;
const BATTLE_MAX_WRONG = 3;
const BATTLE_SECONDS = 10 * 60;
const BATTLE_GRACE_SECONDS = 30; // เผื่อ network ช้า ตอนตอบข้อสุดท้ายใกล้หมดเวลา
const GAME_WORLDS = 6;
const GAME_STAGES_PER_WORLD = 5;
const VALID_BREEDS = ["golden", "shiba", "siberian", "thairidgeback"];

// ชนะด่านด้วยคะแนน (ตอบถูก / ตอบทั้งหมด) ตั้งแต่ 80% ขึ้นไป → ได้เหรียญ (ครั้งแรกที่ผ่านด่านนั้นเท่านั้น)
const REWARD_MIN_PERCENT = 80;
const REWARD_COINS = 10; // เท่ากับอ่าน 5 นาที
const REWARD_COINS_PERFECT = 15; // ตอบถูกหมดไม่ผิดเลย

// ดาวตอนชนะ = หัวใจที่เหลือ: ไม่ผิดเลย 3 ดาว | ผิด 1 ข้อ 2 ดาว | ผิด 2 ข้อ 1 ดาว (แพ้ = 0 ดาว)
function starsFor(status, wrongCount) {
  return status === "won" ? Math.max(1, BATTLE_MAX_WRONG - wrongCount) : 0;
}

function shuffle(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function secondsSince(sqliteDatetime) {
  return Math.floor((Date.now() - new Date(sqliteDatetime + "Z").getTime()) / 1000);
}

// ---------- POST /api/game/battle/start ----------
// ด่านคี่ (1,3,5) = คำถามบทเรียนของโลกนั้น (บทที่ = เลขโลก) | ด่านคู่ (2,4) = คำถามพันธุ์สุนัขที่เลือก
router.post("/battle/start", requireAuth, async (req, res, next) => {
  try {
    const { world, stage, breed } = req.body;
    if (
      !Number.isInteger(world) || world < 1 || world > GAME_WORLDS ||
      !Number.isInteger(stage) || stage < 1 || stage > GAME_STAGES_PER_WORLD
    ) {
      return res.status(400).json({ message: "world/stage ไม่ถูกต้อง" });
    }

    const source = stage % 2 === 0 ? "breed" : "chapter";
    let rows;
    if (source === "breed") {
      if (!VALID_BREEDS.includes(breed)) {
        return res.status(400).json({ message: "พันธุ์สุนัขไม่ถูกต้อง" });
      }
      rows = await db
        .prepare(
          `SELECT id, question, option_1, option_2, option_3, option_4
           FROM breed_quiz_questions WHERE breed = ? AND enabled = 1`
        )
        .all(breed);
    } else {
      rows = await db
        .prepare(
          `SELECT q.id, q.question, q.option_1, q.option_2, q.option_3, q.option_4
           FROM quiz_questions q JOIN chapters c ON c.id = q.chapter_id
           WHERE c.chapter_number = ? AND q.enabled = 1`
        )
        .all(world);
    }

    if (!rows.length) {
      return res.json({ battle: null, questions: [] });
    }

    const questions = shuffle(rows).slice(0, BATTLE_MAX_QUESTIONS);
    const requiredCorrect = questions.length;

    // เลิกการต่อสู้เก่าที่ค้างอยู่ (ปิดหน้า/หมดเวลา) แล้วเริ่มอันใหม่
    const result = await db.tx(async (t) => {
      await t.prepare(
        `UPDATE game_battles SET status = 'cancelled', ended_at = datetime('now')
         WHERE user_id = ? AND status = 'in_progress'`
      ).run(req.user.id);
      return t.prepare(
        `INSERT INTO game_battles (user_id, world, stage, source, question_ids, required_correct)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(req.user.id, world, stage, source, JSON.stringify(questions.map((q) => q.id)), requiredCorrect);
    });

    const rewarded = await db
      .prepare("SELECT coins FROM game_stage_rewards WHERE user_id = ? AND world = ? AND stage = ?")
      .get(req.user.id, world, stage);

    return res.status(201).json({
      battle: {
        id: result.lastInsertRowid,
        requiredCorrect,
        maxWrong: BATTLE_MAX_WRONG,
        alreadyRewarded: !!rewarded,
      },
      questions,
    });
  } catch (err) {
    next(err);
  }
});

// ---------- POST /api/game/battle/:battleId/answer ----------
// ตอบข้อปัจจุบันของการต่อสู้ (server รู้เองว่าข้อไหน) — ชนะเมื่อตอบถูกครบ, แพ้เมื่อผิดครบ 3 ข้อหรือหมดเวลา
router.post("/battle/:battleId/answer", requireAuth, async (req, res, next) => {
  try {
    const battleId = Number(req.params.battleId);
    const { picked } = req.body;
    if (!Number.isInteger(picked) || picked < 1 || picked > 4) {
      return res.status(400).json({ message: "picked ไม่ถูกต้อง" });
    }

    const battle = await db.prepare("SELECT * FROM game_battles WHERE id = ?").get(battleId);
    if (!battle || battle.user_id !== req.user.id) {
      return res.status(404).json({ message: "ไม่พบการต่อสู้นี้" });
    }
    if (battle.status !== "in_progress") {
      return res.status(400).json({ message: "การต่อสู้นี้จบไปแล้ว" });
    }
    if (secondsSince(battle.started_at) > BATTLE_SECONDS + BATTLE_GRACE_SECONDS) {
      await db.prepare(
        "UPDATE game_battles SET status = 'lost', ended_at = datetime('now') WHERE id = ? AND status = 'in_progress'"
      ).run(battleId);
      return res.status(400).json({ message: "หมดเวลาต่อสู้แล้ว" });
    }

    const questionIds = JSON.parse(battle.question_ids);
    const answered = battle.correct_count + battle.wrong_count;
    // ตอบผิดแล้วคำถามวนกลับมาข้อแรกๆ ได้ (เหมือนฝั่งหน้าเว็บ) ถ้าคลังคำถามมีน้อย
    const questionId = questionIds[answered % questionIds.length];
    const src = ANSWER_SOURCES[battle.source];

    const question = await db.prepare(`SELECT correct_option FROM ${src.table} WHERE id = ?`).get(questionId);
    if (!question) {
      return res.status(404).json({ message: "ไม่พบคำถามนี้ (อาจถูกลบไปแล้ว) ลองเริ่มด่านใหม่นะ" });
    }

    const correct = picked === question.correct_option;
    const correctCount = battle.correct_count + (correct ? 1 : 0);
    const wrongCount = battle.wrong_count + (correct ? 0 : 1);
    const totalAnswered = correctCount + wrongCount;
    let status = "in_progress";
    if (correctCount >= battle.required_correct) status = "won";
    else if (wrongCount >= BATTLE_MAX_WRONG) status = "lost";

    const scorePercent = Math.round((correctCount / totalAnswered) * 100);
    const stars = starsFor(status, wrongCount);
    let coinsEarned = 0;
    if (status === "won" && scorePercent >= REWARD_MIN_PERCENT) {
      coinsEarned = wrongCount === 0 ? REWARD_COINS_PERFECT : REWARD_COINS;
    }

    const outcome = await db.tx(async (t) => {
      // guard ด้วยจำนวนที่ตอบไปแล้ว กันกดตอบรัวๆ / หลายแท็บ แล้วนับข้อเดียวกันซ้ำ
      const update = await t.prepare(
        `UPDATE game_battles SET correct_count = ?, wrong_count = ?, status = ?,
           ended_at = CASE WHEN ? = 'in_progress' THEN NULL ELSE datetime('now') END
         WHERE id = ? AND status = 'in_progress' AND correct_count = ? AND wrong_count = ?`
      ).run(correctCount, wrongCount, status, status, battleId, battle.correct_count, battle.wrong_count);
      if (update.changes === 0) return null;

      await t.prepare("INSERT INTO quiz_answer_log (user_id, category, correct) VALUES (?, ?, ?)").run(
        req.user.id,
        src.category,
        correct ? 1 : 0
      );

      // ชนะด่านที่เคยได้โบนัสไปแล้ว: เก็บดาวที่ดีที่สุดไว้ (คอยน์ไม่ได้เพิ่ม)
      if (stars > 0) {
        await t.prepare(
          "UPDATE game_stage_rewards SET stars = MAX(stars, ?) WHERE user_id = ? AND world = ? AND stage = ?"
        ).run(stars, req.user.id, battle.world, battle.stage);
      }

      if (coinsEarned === 0) return { coinsAwarded: 0, alreadyRewarded: false };

      // โบนัสได้ครั้งเดียวต่อด่าน — ด่านที่เคยได้ไปแล้ว INSERT จะไม่เกิดอะไรขึ้น
      const reward = await t.prepare(
        `INSERT INTO game_stage_rewards (user_id, world, stage, coins, score_percent, stars) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, world, stage) DO NOTHING`
      ).run(req.user.id, battle.world, battle.stage, coinsEarned, scorePercent, stars);
      if (reward.changes === 0) return { coinsAwarded: 0, alreadyRewarded: true };

      await t.prepare("UPDATE game_battles SET coins_earned = ? WHERE id = ?").run(coinsEarned, battleId);
      await t.prepare("UPDATE users SET coins = coins + ? WHERE id = ?").run(coinsEarned, req.user.id);
      return { coinsAwarded: coinsEarned, alreadyRewarded: false };
    });
    if (!outcome) {
      return res.status(409).json({ message: "ตอบข้อนี้ไปแล้ว รอสักครู่นะ" });
    }

    const response = {
      correct,
      correctOption: question.correct_option,
      status,
      scorePercent,
      stars,
      correctCount,
      totalAnswered,
      coinsEarned: outcome.coinsAwarded,
      alreadyRewarded: outcome.alreadyRewarded,
    };
    if (outcome.coinsAwarded > 0) {
      const user = await db.prepare("SELECT coins FROM users WHERE id = ?").get(req.user.id);
      response.totalCoins = user.coins;
    }
    return res.json(response);
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
