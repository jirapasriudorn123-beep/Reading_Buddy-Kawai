const db = require("../db/database");
const { reviewStatus } = require("./spacedReview");

// ================== การ์ดแดชบอร์ด: สัปดาห์นี้เทียบสัปดาห์ก่อน + % ตอบถูกย้อนหลัง 4 สัปดาห์ ==================
// "สัปดาห์" = ช่วง 7 วันตามวันไทย นับย้อนจากวันนี้ (สัปดาห์นี้ = วันนี้กับ 6 วันก่อนหน้า)
// % ตอบถูก = คำตอบใน review_log ทั้งแบบทดสอบหลังอ่าน (ทุกครั้งที่ทำ รวมครั้งที่ไม่ผ่าน) และด่านบทเรียนในเกม
// ตัดสินว่าดีขึ้น/แย่ลง เมื่อทั้งสองสัปดาห์ตอบอย่างน้อย MIN_ANSWERS ข้อ และต่างกันอย่างน้อย MIN_DELTA_POINTS จุด
// ตัวเลขคิดจาก SQL ทั้งหมด ไม่ผ่าน AI (ข้อความสรุปแบบ AI ยังอยู่ใน readingSummary.js)

const WEEKS = 4;
const MIN_ANSWERS = 10;
const MIN_DELTA_POINTS = 5;
const PASS_PERCENT = 80;
const READING_DROP_RATIO = 0.8; // อ่านน้อยกว่า 80% ของสัปดาห์ก่อน = นับเป็นสาเหตุ
const MIN_WRONG_FOR_WEAK_CHAPTER = 2;

// 0 = สัปดาห์นี้, 1 = สัปดาห์ก่อน, ... (WEEKS - 1) — null ถ้าเก่ากว่านั้น
const WEEK_INDEX_SQL = (col) =>
  `CAST((julianday(date('now', '+7 hours')) - julianday(date(${col}, '+7 hours'))) / 7 AS INTEGER)`;
const IN_RANGE_SQL = (col) =>
  `date(${col}, '+7 hours') > date('now', '+7 hours', '-${WEEKS * 7} days')`;

function thaiDayOffset(days) {
  return new Date(Date.now() + 7 * 60 * 60 * 1000 - days * 86400000).toISOString().slice(0, 10);
}

function pct(correct, answered) {
  return answered > 0 ? Math.round((correct / answered) * 100) : null;
}

async function weeklyProgress(userId) {
  const [answerRows, readingRows, chapterWrongRows, chapters, review] = await Promise.all([
    db
      .prepare(
        `SELECT ${WEEK_INDEX_SQL("created_at")} AS w, COUNT(*) AS answered, SUM(correct) AS correct
         FROM review_log WHERE user_id = ? AND ${IN_RANGE_SQL("created_at")} GROUP BY w`
      )
      .all(userId),
    db
      .prepare(
        `SELECT ${WEEK_INDEX_SQL("started_at")} AS w, COALESCE(SUM(read_seconds), 0) AS seconds,
                COUNT(DISTINCT date(started_at, '+7 hours')) AS days
         FROM reading_sessions WHERE user_id = ? AND status = 'completed' AND ${IN_RANGE_SQL("started_at")} GROUP BY w`
      )
      .all(userId),
    // บทที่ตอบผิดมากที่สุดในสัปดาห์นี้ (ใช้บอกสาเหตุ + ปุ่มอ่านบทนั้นอีกรอบ)
    db
      .prepare(
        `SELECT chapter_id, SUM(1 - correct) AS wrong, COUNT(*) AS answered FROM review_log
         WHERE user_id = ? AND ${WEEK_INDEX_SQL("created_at")} = 0 AND ${IN_RANGE_SQL("created_at")}
         GROUP BY chapter_id ORDER BY wrong DESC LIMIT 1`
      )
      .all(userId),
    db.prepare("SELECT id, chapter_number, title FROM chapters").all(),
    reviewStatus(userId),
  ]);

  const weeks = Array.from({ length: WEEKS }, (_, i) => ({
    index: i,
    from: thaiDayOffset(i * 7 + 6),
    to: thaiDayOffset(i * 7),
    answered: 0,
    correct: 0,
    percent: null,
    minutes: 0,
    daysRead: 0,
  }));
  for (const r of answerRows) {
    const w = weeks[r.w];
    if (!w) continue;
    w.answered = r.answered;
    w.correct = r.correct || 0;
    w.percent = pct(w.correct, w.answered);
  }
  for (const r of readingRows) {
    const w = weeks[r.w];
    if (!w) continue;
    w.minutes = Math.round(r.seconds / 60);
    w.daysRead = r.days;
  }

  const [now, prev] = weeks;
  const comparable = now.answered >= MIN_ANSWERS && prev.answered >= MIN_ANSWERS;
  const deltaPoints = comparable ? now.percent - prev.percent : null;
  let trend = "not_enough";
  if (comparable) {
    if (deltaPoints >= MIN_DELTA_POINTS) trend = "up";
    else if (deltaPoints <= -MIN_DELTA_POINTS) trend = "down";
    else trend = "steady";
  }

  const chapterById = new Map(chapters.map((c) => [c.id, c]));
  const weak = chapterWrongRows[0];
  const weakChapter =
    weak && weak.wrong >= MIN_WRONG_FOR_WEAK_CHAPTER && chapterById.get(weak.chapter_id)
      ? { number: chapterById.get(weak.chapter_id).chapter_number, title: chapterById.get(weak.chapter_id).title, wrong: weak.wrong }
      : null;

  return {
    weeks: [...weeks].reverse(), // เก่า → ใหม่ (ซ้ายไปขวาบนกราฟ)
    thisWeek: now,
    lastWeek: prev,
    trend,
    deltaPoints,
    minutesChangePercent: prev.minutes > 0 ? Math.round(((now.minutes - prev.minutes) / prev.minutes) * 100) : null,
    readingDropped: prev.minutes > 0 && now.minutes < prev.minutes * READING_DROP_RATIO,
    weakChapter,
    reviewDue: review.dueTotal,
    passPercent: PASS_PERCENT,
    minAnswers: MIN_ANSWERS,
  };
}

module.exports = { weeklyProgress, MIN_ANSWERS, MIN_DELTA_POINTS };
