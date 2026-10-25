const db = require("../db/database");
const { generate } = require("./gemini");
const tests = require("./chapterTests");
const { getReadingStreak } = require("./petCare");

// ================== สรุปการอ่าน 7 วันที่ผ่านมา (หน้าแดชบอร์ด — คอมเมนต์ข้อ 9) ==================
// 1) SQL คำนวณตัวเลขทั้งหมด → 2) สร้างข้อความสรุปจากเทมเพลต (ถูกต้องเสมอ)
// 3) ให้ AI เรียบเรียงเป็นภาษาน้องหมา โดยห้ามเพิ่มข้อมูล → 4) ตรวจว่าตัวเลขทุกตัวในข้อความ AI มีอยู่ในข้อมูลจริง
//    ไม่ผ่าน/AI ตอบไม่ได้ → ใช้ข้อความเทมเพลตแทน (เก็บผลตรวจไว้ใน reading_summaries ใช้รายงานความเที่ยงตรงในเล่มข้อ 12)
// สร้างวันละครั้งต่อคน (เก็บไว้ใน reading_summaries) ไม่หักโควต้าถาม AI ของผู้ใช้ | ไม่มีกิจกรรมเลย ไม่เรียก AI
// ตั้งแต่ 23 ต.ค. 2569: แดชบอร์ดวาดตัวเลขเป็นกราฟเอง (การ์ด "สรุปจากน้องหมา") AI เหลือหน้าที่เขียน 1–2 ประโยคใต้กราฟ (format "short")
//   สรุปที่เก็บไว้ในรูปแบบเดิม (เป็นข้อๆ, format "list") จะถูกสร้างใหม่

const SUMMARY_DAYS = 7;
const MAX_WEAK_QUESTIONS = 3;
const MAX_SUMMARY_CHARS = 400;
const SUMMARY_FORMAT = "short";
const SUMMARY_GENERATION_CONFIG = { temperature: 0.2, topP: 0.9, maxOutputTokens: 500 };

const WINDOW_SQL = (col) => `date(${col}, '+7 hours') > date('now', '+7 hours', '-${SUMMARY_DAYS} days')`;

function thaiToday() {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function shorten(text, max = 70) {
  const s = String(text).replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// ---------- 1) ตัวเลขจากข้อมูลจริง ----------
async function collectStats(userId) {
  const [chapters, sessions, doneTests, postWrong, gameRows, aiRow, streak] = await Promise.all([
    db.prepare("SELECT id, chapter_number, title FROM chapters ORDER BY chapter_number ASC").all(),
    db
      .prepare(
        `SELECT chapter_id, read_seconds, date(started_at, '+7 hours') AS day FROM reading_sessions
         WHERE user_id = ? AND status = 'completed' AND ${WINDOW_SQL("started_at")}`
      )
      .all(userId),
    db
      .prepare(
        `SELECT chapter_id, attempt, pre_score, post_score, total FROM chapter_tests
         WHERE user_id = ? AND status = 'completed' AND ${WINDOW_SQL("completed_at")}
         ORDER BY completed_at ASC`
      )
      .all(userId),
    db
      .prepare(
        `SELECT q.question_id, qq.question, qq.chapter_id, qq.topic FROM chapter_test_questions q
         JOIN chapter_tests t ON t.id = q.test_id
         JOIN quiz_questions qq ON qq.id = q.question_id
         WHERE t.user_id = ? AND t.status = 'completed' AND q.post_correct = 0 AND ${WINDOW_SQL("t.completed_at")}`
      )
      .all(userId),
    db
      .prepare(
        `SELECT l.question_id, l.correct, qq.question, qq.chapter_id, qq.topic FROM quiz_answer_log l
         LEFT JOIN quiz_questions qq ON qq.id = l.question_id
         WHERE l.user_id = ? AND l.category = 'subject' AND ${WINDOW_SQL("l.created_at")}`
      )
      .all(userId),
    db
      .prepare(`SELECT COUNT(*) AS n FROM chat_history WHERE user_id = ? AND source = 'gemini' AND ${WINDOW_SQL("created_at")}`)
      .get(userId),
    getReadingStreak(userId),
  ]);
  const chapterById = new Map(chapters.map((c) => [c.id, c]));

  const minutesByChapter = new Map();
  for (const s of sessions) {
    minutesByChapter.set(s.chapter_id, (minutesByChapter.get(s.chapter_id) || 0) + (s.read_seconds || 0) / 60);
  }
  const chapterMinutes = [...minutesByChapter]
    .map(([id, minutes]) => ({ chapter: chapterById.get(id).chapter_number, title: chapterById.get(id).title, minutes: Math.round(minutes) }))
    .sort((a, b) => b.minutes - a.minutes);

  // ข้อที่ยังผิดบ่อย: ผิดใน post สัปดาห์นี้ + ในเกม (ผิดมากกว่าถูก) เรียงตามจำนวนครั้งที่ผิด
  const wrong = new Map();
  const bump = (qid, question, chapterId, topic, delta) => {
    if (!qid || !question) return;
    const w = wrong.get(qid) || { question, chapterId, topic: topic || null, wrong: 0, right: 0 };
    if (delta > 0) w.wrong += 1;
    else w.right += 1;
    wrong.set(qid, w);
  };
  postWrong.forEach((r) => bump(r.question_id, r.question, r.chapter_id, r.topic, 1));
  gameRows.forEach((r) => bump(r.question_id, r.question, r.chapter_id, r.topic, r.correct ? -1 : 1));
  const stillWrong = [...wrong.values()].filter((w) => w.wrong > w.right);

  // รวมข้อที่ผิดเป็น "หัวข้อย่อย" ที่ควรกลับไปทบทวน (เช่น เลขฐานแปด ในบทที่ 1)
  // ข้อที่แอดมินยังไม่ได้ใส่หัวข้อย่อย จะยืนพื้นเป็นข้อของตัวเองโดยใช้ข้อความคำถามแทน
  const byTopic = new Map();
  for (const w of stillWrong) {
    const chapter = chapterById.get(w.chapterId) ? chapterById.get(w.chapterId).chapter_number : null;
    const key = w.topic ? `${chapter}·${w.topic}` : `q${w.question}`;
    const item = byTopic.get(key) || { chapter, topic: w.topic, question: shorten(w.question), wrong: 0, questions: 0 };
    item.wrong += w.wrong;
    item.questions += 1;
    byTopic.set(key, item);
  }
  const weakQuestions = [...byTopic.values()]
    .sort((a, b) => b.wrong - a.wrong || b.questions - a.questions)
    .slice(0, MAX_WEAK_QUESTIONS)
    .map((w) => ({ chapter: w.chapter, topic: w.topic, question: w.question, questions: w.questions, wrongCount: w.wrong }));

  // บทที่อ่านครบเวลาแล้ว รอทำแบบทดสอบหลังอ่าน
  const progress = await Promise.all(chapters.map((c) => tests.chapterProgress(userId, c.id)));
  const pendingPostTests = chapters.filter((c, i) => progress[i].canPostTest).map((c) => c.chapter_number);
  const startedChapters = chapters.filter((c, i) => progress[i].status !== "none").map((c) => c.chapter_number);

  return {
    periodDays: SUMMARY_DAYS,
    readingMinutes: Math.round(sessions.reduce((a, s) => a + (s.read_seconds || 0), 0) / 60),
    rounds: sessions.length,
    daysRead: new Set(sessions.map((s) => s.day)).size,
    streak: streak.current,
    chapterMinutes,
    startedChapters,
    postTests: doneTests.map((t) => ({
      chapter: chapterById.get(t.chapter_id).chapter_number,
      pre: t.pre_score,
      post: t.post_score,
      total: t.total,
    })),
    pendingPostTests,
    weakQuestions,
    gameAnswers: gameRows.length,
    gameCorrect: gameRows.filter((r) => r.correct).length,
    aiQuestions: aiRow.n || 0,
  };
}

function hasActivity(stats) {
  return stats.rounds > 0 || stats.postTests.length > 0 || stats.gameAnswers > 0;
}

// ---------- 2) ข้อความจากเทมเพลต (ถูกต้องเสมอ ใช้เป็นข้อมูลให้ AI และเป็นตัวสำรอง) ----------
function buildFacts(stats) {
  const facts = [];
  if (stats.rounds === 0) {
    facts.push(`${stats.periodDays} วันที่ผ่านมายังไม่ได้อ่านหนังสือเลย`);
  } else {
    facts.push(`${stats.periodDays} วันที่ผ่านมาอ่านไป ${stats.readingMinutes} นาที (${stats.rounds} รอบ) ใน ${stats.daysRead} วัน`);
  }
  if (stats.streak > 0) facts.push(`อ่านติดกัน ${stats.streak} วัน`);
  if (stats.chapterMinutes.length) {
    const top = stats.chapterMinutes[0];
    facts.push(`อ่านบทที่ ${top.chapter} มากที่สุด (${top.minutes} นาที)`);
  }
  // บทที่เริ่มอ่านแล้วแต่สัปดาห์นี้อ่านน้อยที่สุด (รวมบทที่ไม่ได้อ่านเลยในสัปดาห์นี้)
  if (stats.startedChapters.length >= 2) {
    const minutesOf = (n) => (stats.chapterMinutes.find((c) => c.chapter === n) || { minutes: 0 }).minutes;
    const least = [...stats.startedChapters].sort((a, b) => minutesOf(a) - minutesOf(b))[0];
    const top = stats.chapterMinutes[0];
    if (!top || least !== top.chapter) facts.push(`บทที่ ${least} อ่านน้อยที่สุด (${minutesOf(least)} นาที)`);
  }
  for (const t of stats.postTests) {
    facts.push(
      t.pre !== null && t.pre !== undefined
        ? `แบบทดสอบบทที่ ${t.chapter}: ก่อนอ่าน ${t.pre}/${t.total} → หลังอ่าน ${t.post}/${t.total}`
        : `แบบทดสอบหลังอ่านบทที่ ${t.chapter} (อ่านซ้ำ): ${t.post}/${t.total}`
    );
  }
  if (stats.gameAnswers > 0) facts.push(`ทบทวนในเกม ตอบถูก ${stats.gameCorrect} จาก ${stats.gameAnswers} ข้อ`);
  for (const w of stats.weakQuestions) {
    const where = w.chapter ? ` (บทที่ ${w.chapter})` : "";
    facts.push(
      w.topic
        ? `หัวข้อที่ยังพลาดบ่อย: ${w.topic}${where} ผิดไป ${w.wrongCount || w.questions} ครั้ง`
        : `ยังตอบผิดบ่อย: "${w.question}"${where}`
    );
  }
  for (const n of stats.pendingPostTests) facts.push(`บทที่ ${n} อ่านครบเวลาแล้ว รอทำแบบทดสอบหลังอ่าน`);
  return facts;
}

function suggestion(stats) {
  if (stats.pendingPostTests.length) return `ไปทำแบบทดสอบหลังอ่านบทที่ ${stats.pendingPostTests[0]} เพื่อรับคอยน์ที่รออยู่กันเถอะ`;
  if (stats.weakQuestions.length) {
    const w = stats.weakQuestions[0];
    const where = w.chapter ? ` ในบทที่ ${w.chapter}` : "";
    return w.topic
      ? `ลองกลับไปทบทวนหัวข้อ ${w.topic}${where} หรือเล่นด่านทบทวนในเกมดูนะ`
      : `ลองกลับไปทบทวนเรื่อง "${w.question}"${where} หรือเล่นด่านทบทวนในเกมดูนะ`;
  }
  if (stats.rounds === 0) return "เริ่มจากอ่าน 1 รอบ 25 นาทีวันนี้ น้องหมารออยู่นะ";
  return "อ่านต่อเนื่องแบบนี้ทุกวัน แล้วทำแบบทดสอบหลังอ่านให้ครบทุกบทนะ";
}

// สำรองเมื่อ AI ไม่ผ่านการตรวจ: เรื่องเด่น 1 เรื่อง + คำแนะนำ (สั้นเท่ากับที่ให้ AI เขียน)
function highlight(stats) {
  const improved = stats.postTests.filter((t) => t.pre !== null && t.pre !== undefined && t.post > t.pre);
  if (improved.length) {
    const t = improved[improved.length - 1];
    return `บทที่ ${t.chapter} คะแนนขึ้นจาก ${t.pre} เป็น ${t.post} เก่งมาก`;
  }
  if (stats.rounds > 0) return `${stats.periodDays} วันที่ผ่านมาอ่านไป ${stats.readingMinutes} นาที`;
  return "";
}

function templateSummary(stats) {
  const h = highlight(stats);
  return h ? `${h} ${suggestion(stats)}` : suggestion(stats);
}

// ---------- 3) ให้ AI เรียบเรียง ----------
const SUMMARY_SYSTEM_INSTRUCTION = `คุณคือ "น้องหมาผู้ช่วย" ของเว็บส่งเสริมการอ่าน Reading Buddy
งาน: อ่าน "ข้อเท็จจริง" ที่ระบบคำนวณมาให้ แล้วเขียนข้อความสั้นๆ ถึงเจ้าของ ด้วยภาษาไทยที่อบอุ่น เป็นกันเอง ใช้คำแทนตัวว่า "ผม"
(ตัวเลขทั้งหมดแสดงเป็นกราฟอยู่แล้ว ข้อความนี้วางไว้ใต้กราฟ)

กฎ (สำคัญมาก):
- ใช้เฉพาะข้อเท็จจริงที่ให้มา ห้ามเพิ่มข้อมูล ห้ามเดา ห้ามสร้างตัวเลขใหม่ ห้ามคำนวณใหม่ (เช่น ห้ามรวมหรือหาเปอร์เซ็นต์เอง)
- ตัวเลขทุกตัวต้องเขียนเหมือนในข้อเท็จจริงทุกประการ
- เขียน 1–2 ประโยคต่อกัน ไม่ขึ้นบรรทัดใหม่ ไม่ทำเป็นข้อ ไม่ใช้หัวข้อหรือตัวหนา ไม่เกิน 50 คำ
- ชมเรื่องที่ทำได้ดีที่สุด 1 เรื่อง (ถ้ามี เช่น คะแนนหลังอ่านเพิ่มขึ้น) แล้วจบด้วยคำแนะนำที่ให้มา
- ถ้ายังไม่ได้อ่านเลย ให้ชวนอย่างอ่อนโยน ไม่ตำหนิ`;

function buildSummaryPrompt(stats) {
  return `ข้อเท็จจริง:
${buildFacts(stats).map((f) => `- ${f}`).join("\n")}

คำแนะนำที่ต้องใช้: ${suggestion(stats)}`;
}

// ---------- 4) ตรวจตัวเลข ----------
function numbersIn(text) {
  return (String(text).match(/\d+(?:\.\d+)?/g) || []).map(Number);
}

// ตัวเลขทุกตัวในข้อความ AI ต้องมีอยู่ในข้อเท็จจริง/คำแนะนำที่ให้ไป (ไม่รับตัวเลขที่ AI คิดขึ้นเอง)
function validateSummary(text, stats) {
  if (!text || !text.trim()) return "empty";
  if (text.length > MAX_SUMMARY_CHARS) return "too_long";
  const allowed = new Set(numbersIn(buildSummaryPrompt(stats)));
  const unknown = numbersIn(text).filter((n) => !allowed.has(n));
  return unknown.length ? "numbers_mismatch" : "passed";
}

// ---------- สร้าง/ดึงสรุปของวันนี้ ----------
async function getDailySummary(userId) {
  const day = thaiToday();
  const cached = await db
    .prepare("SELECT summary, source, validation, stats_json, format, created_at FROM reading_summaries WHERE user_id = ? AND day = ?")
    .get(userId, day);
  if (cached && cached.format === SUMMARY_FORMAT) {
    const { stats_json: statsJson, ...rest } = cached;
    return { ...rest, day, stats: statsJson ? JSON.parse(statsJson) : null };
  }

  const stats = await collectStats(userId);
  let summary = templateSummary(stats);
  let source = "template";
  let validation = "no_activity";

  if (hasActivity(stats)) {
    try {
      const { text } = await generate({
        systemInstruction: SUMMARY_SYSTEM_INSTRUCTION,
        prompt: buildSummaryPrompt(stats),
        generationConfig: SUMMARY_GENERATION_CONFIG,
      });
      validation = validateSummary(text, stats);
      if (validation === "passed") {
        summary = text.trim();
        source = "ai";
      }
    } catch (err) {
      validation = "ai_error";
    }
  }

  await db
    .prepare(
      `INSERT INTO reading_summaries (user_id, day, summary, source, validation, stats_json, format) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, day) DO UPDATE SET summary = excluded.summary, source = excluded.source,
         validation = excluded.validation, stats_json = excluded.stats_json, format = excluded.format, created_at = datetime('now')`
    )
    .run(userId, day, summary, source, validation, JSON.stringify(stats), SUMMARY_FORMAT);
  return { summary, source, validation, day, created_at: null, stats };
}

module.exports = {
  SUMMARY_DAYS,
  collectStats,
  buildFacts,
  templateSummary,
  buildSummaryPrompt,
  validateSummary,
  getDailySummary,
};
