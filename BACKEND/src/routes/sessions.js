const express = require("express");
const db = require("../db/database");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const { NORMAL_RULES } = require("../services/readingRules");

// คอยน์ต่อก้อนคงที่ (10) ส่วนกี่นาทีได้ 1 ก้อน ล็อกไว้ในเซสชันตั้งแต่เริ่ม (minutes_per_block: 5 ปกติ, 1 โหมดสาธิต)
const COINS_PER_BLOCK = NORMAL_RULES.coinsPerBlock;
const EXTEND_MINUTES = 5;
const MAX_READ_MINUTES = 120;
const AWAY_GRACE_SECONDS = 15;

// จำนวนวินาทีตั้งแต่เวลา datetime('now') ของ SQLite (UTC, ไม่มี timezone ต่อท้าย) จนถึงตอนนี้
function secondsSince(sqliteDatetime) {
  return Math.max(0, Math.floor((Date.now() - new Date(sqliteDatetime + "Z").getTime()) / 1000));
}

function shuffle(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const MAX_ANSWER_MS = 60 * 60 * 1000;

// ================== แบบทดสอบก่อนอ่าน/หลังอ่าน ==================
// ถามข้อเดิมทั้ง 2 ครั้ง ใช้ดูว่าอ่านแล้วตอบได้ดีขึ้นไหม | ต้องทำแบบทดสอบหลังอ่านก่อนถึงจะได้คอยน์ของรอบนั้น

async function loadSessionQuestions(sessionId) {
  return db
    .prepare(
      `SELECT sq.position, sq.question_id, sq.pre_picked, sq.post_picked,
              q.question, q.option_1, q.option_2, q.option_3, q.option_4, q.correct_option
       FROM reading_session_questions sq
       JOIN quiz_questions q ON q.id = sq.question_id
       WHERE sq.session_id = ?
       ORDER BY sq.position ASC`
    )
    .all(sessionId);
}

function toQuizItem(q) {
  return { position: q.position, question: q.question, options: [q.option_1, q.option_2, q.option_3, q.option_4] };
}

// คำตอบจากหน้าเว็บ: [{ position, picked, ms }] ต้องตอบครบทุกข้อของรอบนี้ ข้อละครั้ง
// picked = 1-4 (ก่อนอ่านส่ง 0 ได้ = "ยังไม่รู้") คืน Map(position → { picked, ms }) หรือ null ถ้าไม่ถูกต้อง
function parseAnswers(body, questions, allowUnknown) {
  const answers = Array.isArray(body.answers) ? body.answers : null;
  if (!answers || answers.length !== questions.length) return null;

  const validPositions = new Set(questions.map((q) => q.position));
  const byPosition = new Map();
  for (const a of answers) {
    const position = Number(a && a.position);
    const picked = Number(a && a.picked);
    if (!validPositions.has(position) || byPosition.has(position)) return null;
    if (!Number.isInteger(picked) || picked < (allowUnknown ? 0 : 1) || picked > 4) return null;
    const ms = Number(a.ms);
    byPosition.set(position, {
      picked,
      ms: Number.isFinite(ms) && ms >= 0 ? Math.min(Math.round(ms), MAX_ANSWER_MS) : null,
    });
  }
  return byPosition;
}

// ---------- POST /api/sessions/:sessionId/pre-test ----------
// ส่งคำตอบก่อนอ่าน → เริ่มนับเวลาอ่านจากตอนนี้ (ไม่บอกผลถูก/ผิด จะเฉลยพร้อมกันหลังทำแบบทดสอบหลังอ่าน)
router.post("/:sessionId/pre-test", requireAuth, async (req, res, next) => {
  try {
    const sessionId = Number(req.params.sessionId);
    const session = await db.prepare("SELECT id, user_id, status FROM reading_sessions WHERE id = ?").get(sessionId);

    if (!session || session.user_id !== req.user.id) {
      return res.status(404).json({ message: "ไม่พบเซสชันการอ่านนี้" });
    }
    if (session.status !== "pre_test") {
      return res.status(400).json({ message: "ทำแบบทดสอบก่อนอ่านของรอบนี้ไปแล้ว" });
    }

    const questions = await loadSessionQuestions(sessionId);
    const answers = parseAnswers(req.body, questions, true);
    if (!answers) {
      return res.status(400).json({ message: "กรุณาตอบให้ครบทุกข้อ" });
    }
    const preScore = questions.filter((q) => answers.get(q.position).picked === q.correct_option).length;

    // guard ด้วย status กันส่งซ้ำพร้อมกัน — started_at รีเซ็ตเป็นตอนนี้ เวลาทำแบบทดสอบไม่นับเป็นเวลาอ่าน
    const started = await db.tx(async (t) => {
      const update = await t.prepare(
        `UPDATE reading_sessions SET status = 'in_progress', started_at = datetime('now'), pre_score = ?
         WHERE id = ? AND status = 'pre_test'`
      ).run(preScore, sessionId);
      if (update.changes === 0) return false;
      for (const q of questions) {
        const a = answers.get(q.position);
        await t.prepare(
          `UPDATE reading_session_questions
           SET pre_picked = ?, pre_correct = ?, pre_ms = ?, pre_answered_at = datetime('now')
           WHERE session_id = ? AND position = ?`
        ).run(a.picked, a.picked === q.correct_option ? 1 : 0, a.ms, sessionId, q.position);
      }
      return true;
    });
    if (!started) {
      return res.status(400).json({ message: "ทำแบบทดสอบก่อนอ่านของรอบนี้ไปแล้ว" });
    }

    return res.json({ message: "เริ่มจับเวลาอ่านแล้ว" });
  } catch (err) {
    next(err);
  }
});

// ---------- POST /api/sessions/:sessionId/complete ----------
// จบช่วงอ่าน (อ่านครบเวลาหรือกด "หยุด") — คิดเวลาที่อ่านจริงและคอยน์ของรอบนี้ไว้
// ถ้ารอบนี้มีแบบทดสอบ คอยน์จะยังไม่เข้า ต้องส่งแบบทดสอบหลังอ่าน (/post-test) ก่อน
router.post("/:sessionId/complete", requireAuth, async (req, res) => {
  try {
    const sessionId = Number(req.params.sessionId);

    const session = await db
      .prepare(
        `SELECT rs.id, rs.user_id, rs.chapter_id, rs.planned_read_seconds, rs.status, rs.started_at,
                rs.away_seconds, rs.away_started_at, rs.minutes_per_block, rs.quiz_total,
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
    const minutesPerBlock = session.minutes_per_block || NORMAL_RULES.minutesPerBlock;
    const coinsEarned = Math.floor(effectiveElapsedMinutes / minutesPerBlock) * COINS_PER_BLOCK;
    const completedFullDuration = effectiveElapsedSeconds >= session.planned_read_seconds;

    // ---- รอบที่มีแบบทดสอบ: เก็บเวลาอ่าน + คอยน์ที่จะได้ไว้ก่อน แล้วส่งคำถามหลังอ่าน (ข้อเดิม สลับลำดับ) ----
    if (session.quiz_total > 0) {
      const moved = await db.prepare(
        `UPDATE reading_sessions SET status = 'post_test', ended_at = datetime('now'), coins_earned = ?, read_seconds = ?
         WHERE id = ? AND status = 'in_progress'`
      ).run(coinsEarned, effectiveElapsedSeconds, sessionId);
      if (moved.changes === 0) {
        return res.status(400).json({ message: "เซสชันนี้จบไปแล้ว หรือถูกยกเลิกไปแล้ว" });
      }
      const questions = await loadSessionQuestions(sessionId);
      return res.json({
        message: "หมดเวลาอ่านแล้ว ทำแบบทดสอบหลังอ่านเพื่อรับคอยน์",
        chapterTitle: session.chapter_title,
        elapsedSeconds,
        awaySeconds,
        readSeconds: effectiveElapsedSeconds,
        plannedReadSeconds: session.planned_read_seconds,
        completedFullDuration,
        coinsPending: coinsEarned,
        postTest: shuffle(questions).map(toQuizItem),
      });
    }

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

// ---------- POST /api/sessions/:sessionId/post-test ----------
// ส่งคำตอบหลังอ่าน → ปิดเซสชัน + ให้คอยน์ของรอบนี้ แล้วเฉลยเทียบก่อนอ่าน/หลังอ่าน
router.post("/:sessionId/post-test", requireAuth, async (req, res, next) => {
  try {
    const sessionId = Number(req.params.sessionId);
    const session = await db
      .prepare(
        `SELECT id, user_id, status, coins_earned, read_seconds, planned_read_seconds, pre_score
         FROM reading_sessions WHERE id = ?`
      )
      .get(sessionId);

    if (!session || session.user_id !== req.user.id) {
      return res.status(404).json({ message: "ไม่พบเซสชันการอ่านนี้" });
    }
    if (session.status !== "post_test") {
      return res.status(400).json({ message: "รอบนี้ไม่ได้รอทำแบบทดสอบหลังอ่านแล้ว" });
    }

    const questions = await loadSessionQuestions(sessionId);
    const answers = parseAnswers(req.body, questions, false);
    if (!answers) {
      return res.status(400).json({ message: "กรุณาตอบให้ครบทุกข้อ" });
    }
    const postScore = questions.filter((q) => answers.get(q.position).picked === q.correct_option).length;

    // atomic guard: ส่งซ้ำ/หลายแท็บพร้อมกัน ได้คอยน์ครั้งเดียว
    const closed = await db.tx(async (t) => {
      const update = await t.prepare(
        "UPDATE reading_sessions SET status = 'completed', post_score = ? WHERE id = ? AND status = 'post_test'"
      ).run(postScore, sessionId);
      if (update.changes === 0) return false;
      for (const q of questions) {
        const a = answers.get(q.position);
        await t.prepare(
          `UPDATE reading_session_questions
           SET post_picked = ?, post_correct = ?, post_ms = ?, post_answered_at = datetime('now')
           WHERE session_id = ? AND position = ?`
        ).run(a.picked, a.picked === q.correct_option ? 1 : 0, a.ms, sessionId, q.position);
      }
      await t.prepare("UPDATE users SET coins = coins + ? WHERE id = ?").run(session.coins_earned, req.user.id);
      return true;
    });
    if (!closed) {
      return res.status(400).json({ message: "รอบนี้ไม่ได้รอทำแบบทดสอบหลังอ่านแล้ว" });
    }

    const user = await db.prepare("SELECT coins FROM users WHERE id = ?").get(req.user.id);
    return res.json({
      message: "ทำแบบทดสอบหลังอ่านเรียบร้อย ได้รับคอยน์ของรอบนี้แล้ว",
      coinsEarned: session.coins_earned,
      totalCoins: user.coins,
      readSeconds: session.read_seconds,
      plannedReadSeconds: session.planned_read_seconds,
      total: questions.length,
      preScore: session.pre_score,
      postScore,
      results: questions.map((q) => ({
        ...toQuizItem(q),
        correctOption: q.correct_option,
        prePicked: q.pre_picked,
        postPicked: answers.get(q.position).picked,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ---------- POST /api/sessions/:sessionId/skip-post-test ----------
// ไม่ทำแบบทดสอบหลังอ่าน = ไม่ได้คอยน์รอบนี้ และไม่นับเป็นเวลาอ่าน (สถิติ/เป้าหมายนับเฉพาะ status completed)
router.post("/:sessionId/skip-post-test", requireAuth, async (req, res, next) => {
  try {
    const result = await db.prepare(
      `UPDATE reading_sessions SET status = 'skipped_post', coins_earned = 0
       WHERE id = ? AND user_id = ? AND status = 'post_test'`
    ).run(Number(req.params.sessionId), req.user.id);
    if (result.changes === 0) {
      return res.status(400).json({ message: "รอบนี้ไม่ได้รอทำแบบทดสอบหลังอ่านแล้ว" });
    }
    return res.json({ message: "ข้ามแบบทดสอบหลังอ่านแล้ว รอบนี้ไม่ได้รับคอยน์" });
  } catch (err) {
    next(err);
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
    // ยกเลิกได้ตั้งแต่ตอนทำแบบทดสอบก่อนอ่านจนถึงระหว่างอ่าน (จบช่วงอ่านแล้วต้องทำแบบทดสอบหลังอ่านหรือกดข้ามแทน)
    if (session.status !== "pre_test" && session.status !== "in_progress") {
      return res.status(400).json({ message: "เซสชันนี้จบไปแล้ว หรือถูกยกเลิกไปแล้ว" });
    }

    await db.prepare(
      "UPDATE reading_sessions SET status = 'cancelled', ended_at = datetime('now') WHERE id = ? AND status = ?"
    ).run(sessionId, session.status);

    return res.json({ message: "ยกเลิกเซสชันการอ่านแล้ว" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
