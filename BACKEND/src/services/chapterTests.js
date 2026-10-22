const db = require("../db/database");
const { getReadingRules } = require("./readingRules");
const { recordReview } = require("./spacedReview");

// ================== แบบทดสอบก่อนอ่าน/หลังอ่าน รายบท ==================
// pre 10 ข้อ (สุ่มจากคลังคำถามมินิเกมของบทนั้น) ตอนเริ่มอ่านบทครั้งแรก → อ่านกี่รอบก็ได้ (คอยน์จากเวลาค้างไว้) → อ่านครบเวลาขั้นต่ำของบท → post 10 ข้อเดิม สลับแค่ลำดับข้อ
// post ผ่าน (≥ 8 จาก 10): ได้คอยน์จากเวลาที่ค้างไว้ทั้งหมด + โบนัสข้อละ 10 คอยน์ (เฉพาะข้อที่ไม่เคยตอบถูกใน post มาก่อน)
// post ไม่ผ่าน: ไม่ได้คอยน์ กลับไปสถานะอ่าน ทำ post ใหม่ได้ทันที (ข้อเดิม สลับลำดับ) หรือกลับไปอ่านก่อนก็ได้ ทำได้จนกว่าจะผ่าน
// ได้คอยน์จากบทหนึ่งๆ สูงสุด 4 ครั้ง (นับชุดที่ผ่าน) — ครบแล้วอ่านทบทวน/ทำ post ได้แต่ไม่ได้คอยน์
// อ่านบทเดิมซ้ำ = ชุดใหม่ (attempt ถัดไป) ไม่มี pre, post เอาข้อที่ตอบผิดครั้งก่อนมาถามเป็นข้อแรก
// ถามทีละข้อ ข้อละ 1 นาที (server จับเวลาเอง) | post: สลับแท็บระหว่างข้อ = ข้อนั้นผิด

const QUESTIONS_PER_TEST = 10;
const SECONDS_PER_QUESTION = 60;
const ANSWER_GRACE_SECONDS = 5; // เผื่อ network ช้าตอนกดตอบใกล้หมดเวลา
const BONUS_PER_CORRECT = 10;
const PASS_RATIO = 0.8; // post ได้ ≥ 80% (8 จาก 10) = ผ่านบทนั้น ได้คอยน์ + นับเงื่อนไขคูปอง
const MAX_COIN_REWARDS_PER_CHAPTER = 4;
// เฉลยข้อที่ผิดหลังทำ post ไหม — ไม่เฉลย ให้กลับไปอ่านแล้วเจอข้อนั้นซ้ำ (ข้อแรกของ post ครั้งหน้า / ในเกมทบทวน)
const REVEAL_WRONG_ANSWERS = false;

function passScore(total) {
  return Math.ceil(total * PASS_RATIO);
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

// ชุดล่าสุดของบทนี้ (null = ยังไม่เคยเริ่มบทนี้)
async function getLatestTest(userId, chapterId, conn = db) {
  return conn
    .prepare("SELECT * FROM chapter_tests WHERE user_id = ? AND chapter_id = ? ORDER BY attempt DESC LIMIT 1")
    .get(userId, chapterId);
}

// เวลาขั้นต่ำที่ต้องอ่านบทนี้ (สะสมในชุดปัจจุบัน) ก่อนทำ post ได้ — แอดมินตั้งรายบท ("ต้องอ่านบทเรียน N นาที")
async function minReadSecondsFor(chapterId) {
  const rules = await getReadingRules();
  if (rules.postTestMinReadMinutes) return rules.postTestMinReadMinutes * 60;
  const chapter = await db.prepare("SELECT game_required_minutes FROM chapters WHERE id = ?").get(chapterId);
  // แอดมินตั้ง 0 ได้ = ไม่ต้องรอ (แต่อย่างน้อยต้องอ่านจบ 1 นาที กันกดทำ post ทันทีโดยไม่ได้อ่าน)
  return Math.max(1, chapter ? chapter.game_required_minutes ?? 20 : 20) * 60;
}

// บทนี้ได้คอยน์ไปแล้วกี่ครั้ง (ชุดที่ทำ post จบ = ผ่านแล้ว) — ครบ MAX_COIN_REWARDS_PER_CHAPTER แล้วไม่ได้คอยน์อีก
async function coinRewardsUsed(userId, chapterId, conn = db) {
  const row = await conn
    .prepare("SELECT COUNT(*) AS c FROM chapter_tests WHERE user_id = ? AND chapter_id = ? AND status = 'completed'")
    .get(userId, chapterId);
  return row.c || 0;
}

async function testReadingTotals(testId) {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(read_seconds), 0) AS readSeconds,
              COALESCE(SUM(CASE WHEN coins_pending = 1 THEN coins_earned ELSE 0 END), 0) AS pendingCoins
       FROM reading_sessions WHERE chapter_test_id = ? AND status = 'completed'`
    )
    .get(testId);
  return { readSeconds: row.readSeconds || 0, pendingCoins: row.pendingCoins || 0 };
}

// สถานะการอ่านบทนี้ของผู้ใช้ (โชว์ในป๊อปอัพเลือกบท / หลังอ่านจบรอบ)
async function chapterProgress(userId, chapterId) {
  const test = await getLatestTest(userId, chapterId);
  const minReadSeconds = await minReadSecondsFor(chapterId);
  const best = await db
    .prepare(
      `SELECT MAX(post_score) AS bestPost, MAX(total) AS total, COUNT(*) AS completedCount
       FROM chapter_tests WHERE user_id = ? AND chapter_id = ? AND status = 'completed'`
    )
    .get(userId, chapterId);
  const rewardsUsed = best.completedCount || 0;

  const base = {
    status: "none",
    attempt: 0,
    readSeconds: 0,
    minReadSeconds,
    pendingCoins: 0,
    canPostTest: false,
    preScore: null,
    total: QUESTIONS_PER_TEST,
    completedCount: best.completedCount || 0,
    bestPostScore: best.bestPost,
    passed: best.completedCount > 0 && best.bestPost >= passScore(best.total || QUESTIONS_PER_TEST),
    passScore: passScore(QUESTIONS_PER_TEST),
    postTries: 0,
    lastPostScore: null,
    coinRewardsUsed: Math.min(rewardsUsed, MAX_COIN_REWARDS_PER_CHAPTER),
    coinRewardsMax: MAX_COIN_REWARDS_PER_CHAPTER,
    coinRewardsLeft: Math.max(0, MAX_COIN_REWARDS_PER_CHAPTER - rewardsUsed),
  };
  if (!test) return base;

  const { readSeconds, pendingCoins } = await testReadingTotals(test.id);
  // ชุดที่ทำ post จบแล้ว = รอเริ่มชุดใหม่ (อ่านบทซ้ำ) เวลาอ่านของชุดใหม่ยังเป็น 0
  const finished = test.status === "completed";
  return {
    ...base,
    status: test.status,
    attempt: test.attempt,
    readSeconds: finished ? 0 : readSeconds,
    pendingCoins: finished ? 0 : pendingCoins,
    canPostTest: test.status === "post_test" || (test.status === "reading" && readSeconds >= minReadSeconds),
    preScore: test.pre_score,
    total: test.total || QUESTIONS_PER_TEST,
    passScore: passScore(test.total || QUESTIONS_PER_TEST),
    postTries: finished ? 0 : test.post_tries || 0,
    lastPostScore: finished ? null : test.last_post_score,
  };
}

// ---------- เลือกคำถาม ----------

// pre ของชุดแรก: สุ่ม 10 ข้อจากคำถามบทเรียนของบทนี้ (ชุดเดียวกับมินิเกม)
async function pickPreQuestions(chapterId) {
  const rows = await db
    .prepare("SELECT id FROM quiz_questions WHERE chapter_id = ? AND enabled = 1 ORDER BY RANDOM() LIMIT ?")
    .all(chapterId, QUESTIONS_PER_TEST);
  return rows.map((r) => r.id);
}

// post ของชุดที่อ่านซ้ำ: ข้อที่ตอบผิดใน post ครั้งล่าสุดของบทนี้มาก่อน แล้วเติมด้วยข้อที่ยังไม่เคยตอบถูกใน post
// (ยังไม่เคยถามมาก่อนได้ก่อน) ถ้ายังไม่ครบ 10 ค่อยเติมข้อที่เคยตอบถูกแล้ว
async function pickRepeatPostQuestions(userId, chapterId) {
  const lastWrong = await db
    .prepare(
      `SELECT q.question_id AS id FROM chapter_test_questions q
       JOIN chapter_tests t ON t.id = q.test_id
       JOIN quiz_questions qq ON qq.id = q.question_id AND qq.enabled = 1
       WHERE t.id = (SELECT id FROM chapter_tests WHERE user_id = ? AND chapter_id = ? AND status = 'completed'
                     ORDER BY attempt DESC LIMIT 1)
         AND q.post_correct = 0
       ORDER BY q.post_order ASC`
    )
    .all(userId, chapterId);
  const picked = lastWrong.map((r) => r.id).slice(0, QUESTIONS_PER_TEST);

  const others = await db
    .prepare(
      `SELECT qq.id,
              EXISTS (SELECT 1 FROM chapter_test_questions q JOIN chapter_tests t ON t.id = q.test_id
                      WHERE t.user_id = ? AND q.question_id = qq.id AND q.post_correct = 1) AS everCorrect,
              EXISTS (SELECT 1 FROM chapter_test_questions q JOIN chapter_tests t ON t.id = q.test_id
                      WHERE t.user_id = ? AND q.question_id = qq.id) AS everAsked
       FROM quiz_questions qq WHERE qq.chapter_id = ? AND qq.enabled = 1`
    )
    .all(userId, userId, chapterId);
  const rank = (q) => (q.everCorrect ? 2 : q.everAsked ? 1 : 0);
  const rest = shuffle(others.filter((q) => !picked.includes(q.id))).sort((a, b) => rank(a) - rank(b));
  for (const q of rest) {
    if (picked.length >= QUESTIONS_PER_TEST) break;
    picked.push(q.id);
  }
  return picked;
}

// ---------- เริ่มชุด / เริ่ม post ----------

// หาชุดที่กำลังทำของบทนี้ หรือสร้างชุดใหม่ถ้ายังไม่มี/ชุดล่าสุดจบไปแล้ว
// ชุดแรกของบท = pre_test (สุ่มคำถามไว้เลย) | ชุดถัดไป = reading (ไม่มี pre)
async function getOrCreateActiveTest(userId, chapterId) {
  const latest = await getLatestTest(userId, chapterId);
  if (latest && latest.status !== "completed") return latest;

  const attempt = latest ? latest.attempt + 1 : 1;
  const questionIds = attempt === 1 ? await pickPreQuestions(chapterId) : [];
  // บทที่ยังไม่มีคำถามเลย ข้าม pre ไปอ่านได้ทันที (post จะจบทันทีแล้วปล่อยคอยน์)
  const status = attempt === 1 && questionIds.length > 0 ? "pre_test" : "reading";

  try {
    await db.tx(async (t) => {
      const inserted = await t.prepare(
        `INSERT INTO chapter_tests (user_id, chapter_id, attempt, status, total) VALUES (?, ?, ?, ?, ?)`
      ).run(userId, chapterId, attempt, status, questionIds.length);
      for (const [i, qid] of questionIds.entries()) {
        await t.prepare(
          "INSERT INTO chapter_test_questions (test_id, question_id, pre_order, post_order) VALUES (?, ?, ?, NULL)"
        ).run(inserted.lastInsertRowid, qid, i + 1);
      }
    });
  } catch (err) {
    // กดพร้อมกันสองแท็บ: อีกแท็บสร้างชุดนี้ไปแล้ว (UNIQUE user+chapter+attempt) ใช้ของที่มีอยู่
    if (!String(err.message).includes("UNIQUE")) throw err;
  }
  return getLatestTest(userId, chapterId);
}

// เริ่ม post ของชุดที่กำลังอ่าน (ต้องอ่านครบเวลาขั้นต่ำก่อน) — ชุดแรกใช้ 10 ข้อเดิมของ pre สลับลำดับ
// คืน { test } หรือ { error: { status, message } }
async function startPostTest(userId, chapterId) {
  const test = await getLatestTest(userId, chapterId);
  if (!test || test.status === "completed") {
    return { error: { status: 400, message: "ยังไม่ได้เริ่มอ่านบทนี้ เริ่มอ่านก่อนนะ" } };
  }
  if (test.status === "post_test") return { test };
  if (test.status === "pre_test") {
    return { error: { status: 400, message: "ทำแบบทดสอบก่อนอ่านให้เสร็จก่อน" } };
  }

  const [{ readSeconds }, minReadSeconds] = await Promise.all([testReadingTotals(test.id), minReadSecondsFor(chapterId)]);
  if (readSeconds < minReadSeconds) {
    const left = Math.ceil((minReadSeconds - readSeconds) / 60);
    return { error: { status: 400, message: `อ่านบทนี้อีก ${left} นาที ถึงจะทำแบบทดสอบหลังอ่านได้` } };
  }

  // ชุดแรก (มีข้อของ pre) หรือชุดที่เคยทำ post ไม่ผ่านมาแล้ว = ใช้ข้อเดิมของชุดนี้ สลับลำดับใหม่
  // ชุดที่อ่านซ้ำซึ่งยังไม่เคยทำ post: เลือกคำถามก่อนเปิด transaction (อ่านด้วย connection หลักระหว่าง transaction เขียนค้างอยู่ จะติด lock)
  const existing = await db.prepare("SELECT COUNT(*) AS c FROM chapter_test_questions WHERE test_id = ?").get(test.id);
  const reuse = existing.c > 0;
  const repeatIds = reuse ? null : await pickRepeatPostQuestions(userId, chapterId);

  await db.tx(async (t) => {
    const moved = await t.prepare(
      "UPDATE chapter_tests SET status = 'post_test', post_started_at = datetime('now') WHERE id = ? AND status = 'reading'"
    ).run(test.id);
    if (moved.changes === 0) return; // อีกแท็บเริ่มไปแล้ว

    if (reuse) {
      const rows = await t.prepare("SELECT question_id FROM chapter_test_questions WHERE test_id = ?").all(test.id);
      for (const [i, r] of shuffle(rows).entries()) {
        await t.prepare("UPDATE chapter_test_questions SET post_order = ? WHERE test_id = ? AND question_id = ?").run(
          i + 1,
          test.id,
          r.question_id
        );
      }
    } else {
      const ids = repeatIds;
      for (const [i, qid] of ids.entries()) {
        await t.prepare(
          "INSERT INTO chapter_test_questions (test_id, question_id, post_order) VALUES (?, ?, ?)"
        ).run(test.id, qid, i + 1);
      }
      await t.prepare("UPDATE chapter_tests SET total = ? WHERE id = ?").run(ids.length, test.id);
    }
  });
  // ไม่ได้ลบ pending session ที่ยังไม่จบ — รอบที่กำลังอ่านค้าง (in_progress) จะยกเลิกตอนเริ่มรอบใหม่
  return { test: await getLatestTest(userId, chapterId) };
}

// ---------- ถาม/ตอบทีละข้อ ----------

function phaseOf(test) {
  if (test.status === "pre_test") return "pre";
  if (test.status === "post_test") return "post";
  return null;
}

function col(phase, name) {
  return `${phase}_${name}`;
}

async function phaseQuestions(testId, phase) {
  return db
    .prepare(
      `SELECT q.*, qq.question, qq.option_1, qq.option_2, qq.option_3, qq.option_4, qq.correct_option
       FROM chapter_test_questions q JOIN quiz_questions qq ON qq.id = q.question_id
       WHERE q.test_id = ? AND q.${col(phase, "order")} IS NOT NULL
       ORDER BY q.${col(phase, "order")} ASC`
    )
    .all(testId);
}

// บันทึกคำตอบข้อที่กำลังถามอยู่ (guard ด้วย picked IS NULL กันตอบซ้ำ/หลายแท็บ)
async function recordAnswer(testId, phase, q, picked, flags = {}) {
  const correct = picked > 0 && picked === q.correct_option ? 1 : 0;
  const extra = phase === "post" ? ", post_timed_out = ?, post_tab_switched = ?" : "";
  const extraArgs = phase === "post" ? [flags.timedOut ? 1 : 0, flags.tabSwitched ? 1 : 0] : [];
  const res = await db
    .prepare(
      `UPDATE chapter_test_questions
       SET ${col(phase, "picked")} = ?, ${col(phase, "correct")} = ?, ${col(phase, "answered_at")} = datetime('now')${extra}
       WHERE test_id = ? AND question_id = ? AND ${col(phase, "picked")} IS NULL`
    )
    .run(picked, correct, ...extraArgs, testId, q.question_id);
  return res.changes > 0;
}

function expired(q, phase) {
  const shownAt = q[col(phase, "shown_at")];
  return shownAt && secondsSince(shownAt) > SECONDS_PER_QUESTION + ANSWER_GRACE_SECONDS;
}

function toClientQuestion(q, phase, index, total) {
  const shownAt = q[col(phase, "shown_at")];
  return {
    index: index + 1,
    total,
    question: q.question,
    options: [q.option_1, q.option_2, q.option_3, q.option_4],
    secondsLeft: Math.max(0, SECONDS_PER_QUESTION - (shownAt ? secondsSince(shownAt) : 0)),
    allowUnknown: phase === "pre",
  };
}

// ส่งข้อถัดไปของ phase ปัจจุบัน (ข้อที่เปิดดูไปแล้วแต่หมดเวลา → นับผิดแล้วข้ามไป เช่น ปิดหน้าไปหาคำตอบแล้วกลับมา)
// คืน { phase, question } หรือ { phase, done: true, summary } ถ้าตอบครบแล้ว
async function serveNext(userId, test) {
  const phase = phaseOf(test);
  const questions = await phaseQuestions(test.id, phase);

  for (const [i, q] of questions.entries()) {
    if (q[col(phase, "picked")] !== null) continue;
    if (q[col(phase, "shown_at")]) {
      if (expired(q, phase)) {
        await recordAnswer(test.id, phase, q, 0, { timedOut: true });
        continue;
      }
      return { phase, question: toClientQuestion(q, phase, i, questions.length) };
    }
    await db
      .prepare(
        `UPDATE chapter_test_questions SET ${col(phase, "shown_at")} = datetime('now')
         WHERE test_id = ? AND question_id = ? AND ${col(phase, "shown_at")} IS NULL`
      )
      .run(test.id, q.question_id);
    return { phase, question: toClientQuestion({ ...q, [col(phase, "shown_at")]: null }, phase, i, questions.length) };
  }

  return { phase, done: true, summary: await finishPhase(userId, test, phase) };
}

// ตอบข้อที่กำลังถามอยู่ แล้วส่งข้อถัดไป (หรือสรุปผลถ้าครบ)
// picked: pre 0-4 (0 = ยังไม่รู้/หมดเวลา) | post 0-4 (0 = หมดเวลา) — post ที่สลับแท็บนับผิดเสมอ
async function answerCurrent(userId, test, picked, tabSwitched) {
  const phase = phaseOf(test);
  const questions = await phaseQuestions(test.id, phase);
  const current = questions.find((q) => q[col(phase, "picked")] === null && q[col(phase, "shown_at")]);
  if (current) {
    const late = expired(current, phase);
    const switched = phase === "post" && !!tabSwitched;
    const finalPick = late || switched ? 0 : picked;
    // post: เลือก 0 = หมดเวลา (หน้าเว็บส่งมาตอนนับถอยหลังหมด) | pre: 0 = กด "ยังไม่รู้"
    const timedOut = late || (phase === "post" && picked === 0 && !switched);
    await recordAnswer(test.id, phase, current, finalPick, { timedOut, tabSwitched: switched });
  }
  return serveNext(userId, test);
}

// ---------- ปิด phase ----------

async function finishPhase(userId, test, phase) {
  if (phase === "pre") {
    const row = await db
      .prepare("SELECT COALESCE(SUM(pre_correct), 0) AS score FROM chapter_test_questions WHERE test_id = ? AND pre_order IS NOT NULL")
      .get(test.id);
    await db
      .prepare(
        "UPDATE chapter_tests SET status = 'reading', pre_score = ?, pre_done_at = datetime('now') WHERE id = ? AND status = 'pre_test'"
      )
      .run(row.score, test.id);
    // บอกแค่ข้อไหนถูก/ผิด ไม่เฉลย (ข้อเดียวกันจะถูกถามอีกใน post)
    const questions = await phaseQuestions(test.id, "pre");
    return {
      phase: "pre",
      preScore: row.score,
      total: test.total,
      results: questions.map((q) => ({
        question: q.question,
        options: [q.option_1, q.option_2, q.option_3, q.option_4],
        picked: q.pre_picked,
        correct: q.pre_correct === 1,
      })),
    };
  }
  return finishPostTest(userId, test);
}

// ปิด post
// ผ่าน (≥ 80%): ชุดนี้ completed ปล่อยคอยน์จากเวลาอ่านที่ค้างไว้ทั้งหมด + โบนัสข้อที่ถูก (ข้อที่ไม่เคยตอบถูกใน post มาก่อน)
//   — ถ้าบทนี้ได้คอยน์ครบ 4 ครั้งแล้ว คอยน์ที่ค้างไว้ไม่จ่าย (ปิด pending ทิ้ง)
// ไม่ผ่าน: ไม่ได้คอยน์ (คอยน์จากเวลายังค้างไว้) กลับไป status reading ล้างคำตอบ post ไว้ทำใหม่ด้วยข้อเดิม
async function finishPostTest(userId, test) {
  const questions = await phaseQuestions(test.id, "post");
  const postScore = questions.filter((q) => q.post_correct === 1).length;
  const passed = postScore >= passScore(questions.length);
  const rules = await getReadingRules();

  const result = await db.tx(async (t) => {
    const closed = passed
      ? await t.prepare(
          `UPDATE chapter_tests SET status = 'completed', post_score = ?, completed_at = datetime('now'),
             post_tries = post_tries + 1, first_post_score = COALESCE(first_post_score, ?), last_post_score = ?
           WHERE id = ? AND status = 'post_test'`
        ).run(postScore, postScore, postScore, test.id)
      : await t.prepare(
          `UPDATE chapter_tests SET status = 'reading', post_started_at = NULL,
             post_tries = post_tries + 1, first_post_score = COALESCE(first_post_score, ?), last_post_score = ?
           WHERE id = ? AND status = 'post_test'`
        ).run(postScore, postScore, test.id);
    if (closed.changes === 0) return null; // อีกแท็บปิดไปแล้ว

    // นัดทบทวนแบบเว้นระยะ: ข้อผิดถึงรอบทันที ข้อถูกนัดพรุ่งนี้ (ดู services/spacedReview.js)
    for (const q of questions) {
      await recordReview(t, rules, {
        userId,
        questionId: q.question_id,
        chapterId: test.chapter_id,
        correct: q.post_correct === 1,
        source: "post",
      });
    }

    if (!passed) {
      await t.prepare(
        `UPDATE chapter_test_questions
         SET post_order = NULL, post_shown_at = NULL, post_picked = NULL, post_correct = NULL,
             post_timed_out = 0, post_tab_switched = 0, post_answered_at = NULL
         WHERE test_id = ?`
      ).run(test.id);
      return { coinsTime: 0, coinsBonus: 0, rewardLimitReached: false };
    }

    // นับชุดที่ผ่านก่อนหน้าชุดนี้ (ชุดนี้เพิ่ง completed ไปข้างบน จึงลบ 1)
    const rewardLimitReached = (await coinRewardsUsed(userId, test.chapter_id, t)) - 1 >= MAX_COIN_REWARDS_PER_CHAPTER;
    if (rewardLimitReached) {
      await t.prepare("UPDATE reading_sessions SET coins_pending = 0 WHERE chapter_test_id = ? AND coins_pending = 1").run(test.id);
      return { coinsTime: 0, coinsBonus: 0, rewardLimitReached };
    }

    let bonusCount = 0;
    for (const q of questions) {
      if (q.post_correct !== 1) continue;
      const before = await t.prepare(
        `SELECT 1 FROM chapter_test_questions cq JOIN chapter_tests ct ON ct.id = cq.test_id
         WHERE ct.user_id = ? AND ct.id != ? AND cq.question_id = ? AND cq.post_correct = 1 LIMIT 1`
      ).get(userId, test.id, q.question_id);
      if (!before) bonusCount += 1;
    }
    const coinsBonus = bonusCount * BONUS_PER_CORRECT;

    const pending = await t.prepare(
      `SELECT COALESCE(SUM(coins_earned), 0) AS c FROM reading_sessions
       WHERE chapter_test_id = ? AND status = 'completed' AND coins_pending = 1`
    ).get(test.id);
    const coinsTime = pending.c || 0;
    await t.prepare("UPDATE reading_sessions SET coins_pending = 0 WHERE chapter_test_id = ? AND coins_pending = 1").run(test.id);
    await t.prepare("UPDATE chapter_tests SET coins_time = ?, coins_bonus = ? WHERE id = ?").run(coinsTime, coinsBonus, test.id);
    await t.prepare("UPDATE users SET coins = coins + ? WHERE id = ?").run(coinsTime + coinsBonus, userId);
    return { coinsTime, coinsBonus, rewardLimitReached: false };
  });

  const fresh = await db.prepare("SELECT * FROM chapter_tests WHERE id = ?").get(test.id);
  const user = await db.prepare("SELECT coins FROM users WHERE id = ?").get(userId);
  const rewardsUsed = await coinRewardsUsed(userId, test.chapter_id);
  return {
    phase: "post",
    attempt: fresh.attempt,
    preScore: fresh.pre_score,
    postScore,
    total: questions.length,
    passed,
    passScore: passScore(questions.length),
    postTries: fresh.post_tries,
    coinsTime: result ? result.coinsTime : passed ? fresh.coins_time : 0,
    coinsBonus: result ? result.coinsBonus : passed ? fresh.coins_bonus : 0,
    rewardLimitReached: result ? result.rewardLimitReached : false,
    coinRewardsUsed: Math.min(rewardsUsed, MAX_COIN_REWARDS_PER_CHAPTER),
    coinRewardsMax: MAX_COIN_REWARDS_PER_CHAPTER,
    pendingCoins: passed ? 0 : (await testReadingTotals(test.id)).pendingCoins,
    bonusPerCorrect: BONUS_PER_CORRECT,
    totalCoins: user.coins,
    results: questions.map((q) => ({
      question: q.question,
      options: [q.option_1, q.option_2, q.option_3, q.option_4],
      prePicked: q.pre_order ? q.pre_picked : undefined,
      postPicked: q.post_picked,
      correct: q.post_correct === 1,
      timedOut: q.post_timed_out === 1,
      tabSwitched: q.post_tab_switched === 1,
      correctOption: q.post_correct === 1 || REVEAL_WRONG_ANSWERS ? q.correct_option : null,
    })),
  };
}

// ---------- ใช้ร่วมกับเกม/ร้านค้า ----------

// บทที่ทำ post จบแล้วอย่างน้อย 1 ครั้ง (ใช้ปลดล็อกโลกในเกม) คืน Set ของ chapter_number
async function completedChapterNumbers(userId) {
  const rows = await db
    .prepare(
      `SELECT DISTINCT c.chapter_number FROM chapter_tests t JOIN chapters c ON c.id = t.chapter_id
       WHERE t.user_id = ? AND t.status = 'completed'`
    )
    .all(userId);
  return new Set(rows.map((r) => r.chapter_number));
}

// จำนวนบทที่ผ่าน post (≥ 80%) — นับคะแนนที่ดีที่สุดของแต่ละบท
async function passedChapterCount(userId) {
  const rows = await db
    .prepare(
      `SELECT chapter_id, MAX(CAST(post_score AS REAL) / NULLIF(total, 0)) AS ratio
       FROM chapter_tests WHERE user_id = ? AND status = 'completed' GROUP BY chapter_id`
    )
    .all(userId);
  return rows.filter((r) => r.ratio === null || r.ratio >= PASS_RATIO - 1e-9).length;
}

// "ผ่านโลก" ในเกม (เงื่อนไขคูปอง) = ชนะด่านคำถามบทเรียน (ด่านคี่ 1, 3, 5) ของโลกนั้นอย่างน้อย 1 ด่านด้วย 2 ดาวขึ้นไป
// (ตอนนี้แผนที่วาดตำแหน่งด่านไว้ครบเฉพาะโลก 1 โลกอื่นเล่นได้แค่ด่าน 1 จึงนับแค่ "อย่างน้อย 1 ด่าน")
const MIN_STARS_FOR_WORLD_CLEAR = 2;

async function clearedWorldCount(userId) {
  const row = await db
    .prepare(
      `SELECT COUNT(DISTINCT world) AS n FROM game_stage_clears
       WHERE user_id = ? AND stage % 2 = 1 AND best_stars >= ?`
    )
    .get(userId, MIN_STARS_FOR_WORLD_CLEAR);
  return row.n || 0;
}

module.exports = {
  QUESTIONS_PER_TEST,
  SECONDS_PER_QUESTION,
  BONUS_PER_CORRECT,
  PASS_RATIO,
  MAX_COIN_REWARDS_PER_CHAPTER,
  coinRewardsUsed,
  getLatestTest,
  getOrCreateActiveTest,
  startPostTest,
  serveNext,
  answerCurrent,
  phaseOf,
  chapterProgress,
  completedChapterNumbers,
  passedChapterCount,
  MIN_STARS_FOR_WORLD_CLEAR,
  clearedWorldCount,
};
