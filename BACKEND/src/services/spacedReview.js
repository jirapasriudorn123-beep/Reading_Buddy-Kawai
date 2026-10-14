const db = require("../db/database");

// ================== ทบทวนแบบเว้นระยะ (spaced repetition แบบ Leitner) ==================
// แต่ละคน × แต่ละข้อ (คำถามบทเรียน) มี "ขั้น" และ "วันนัดทบทวน" เก็บใน review_items
//   ตอบผิด (post หรือเกม)        → ขั้น 0 ถึงกำหนดทันที (ขึ้นเป็นข้อแรกในเกมของบทนั้น)
//   ตอบถูกตอนถึงกำหนด ขั้น s    → ขั้น s+1 นัดอีก INTERVAL_DAYS[s] วัน (1 → 3 → 7 → 14)
//   ตอบถูกตอนถึงกำหนด ขั้นสุดท้าย → จำได้แล้ว (MASTERED_STAGE) ไม่นัดอีก
//   ตอบถูกใน post ข้อที่ยังไม่มีนัด → ขั้น 1 นัดพรุ่งนี้ (ทบทวนสิ่งที่เพิ่งอ่าน กันลืม)
//   ตอบถูกก่อนถึงกำหนด            → ไม่เลื่อนขั้น (กันทำซ้ำรัวๆ ในวันเดียวเพื่อข้ามขั้น)
// ครบกำหนดตอนเที่ยงคืนเวลาไทยของวันนัด | โหมดสาธิตนับเป็นนาทีแทนวัน (สาธิตครบทุกขั้นได้ในไม่กี่นาที)
// ทุกครั้งที่ตอบบันทึกลง review_log (ขั้นก่อนตอบ / ถึงกำหนดหรือยัง / ถูกผิด) ใช้วัดว่าจำได้แค่ไหนเมื่อเว้นไป 1/3/7/14 วัน

const INTERVAL_DAYS = [1, 3, 7, 14];
const MASTERED_STAGE = INTERVAL_DAYS.length + 1;

function dueSql(rules, days) {
  return rules.demoMode
    ? `datetime('now', '+${days} minutes')`
    : `datetime(date('now', '+7 hours', '+${days} days'), '-7 hours')`;
}

// เรียกใน transaction ของคนเรียก (conn = t) — rules ต้องดึงมาก่อนเข้า transaction
// source: 'post' | 'game'
async function recordReview(conn, rules, { userId, questionId, chapterId, correct, source }) {
  const item = await conn
    .prepare(
      `SELECT stage, due_at, due_at IS NOT NULL AND due_at <= datetime('now') AS is_due
       FROM review_items WHERE user_id = ? AND question_id = ?`
    )
    .get(userId, questionId);

  let stageAfter = item ? item.stage : null;
  let dueExpr = null;
  if (!correct) {
    stageAfter = 0;
    dueExpr = "datetime('now')";
  } else if (!item) {
    if (source === "post") {
      stageAfter = 1;
      dueExpr = dueSql(rules, INTERVAL_DAYS[0]);
    }
  } else if (item.is_due) {
    stageAfter = item.stage + 1;
    dueExpr = stageAfter >= MASTERED_STAGE ? "NULL" : dueSql(rules, INTERVAL_DAYS[item.stage]);
  }

  if (dueExpr) {
    await conn
      .prepare(
        `INSERT INTO review_items (user_id, question_id, chapter_id, stage, due_at, lapses)
         VALUES (?, ?, ?, ?, ${dueExpr}, ?)
         ON CONFLICT(user_id, question_id) DO UPDATE SET
           stage = excluded.stage, due_at = excluded.due_at,
           lapses = review_items.lapses + excluded.lapses, updated_at = datetime('now')`
      )
      .run(userId, questionId, chapterId, stageAfter, correct ? 0 : 1);
  }

  await conn
    .prepare(
      `INSERT INTO review_log (user_id, question_id, chapter_id, source, stage_before, was_due, correct, stage_after)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(userId, questionId, chapterId, source, item ? item.stage : null, item && item.is_due ? 1 : 0, correct ? 1 : 0, stageAfter);
}

// ข้อของบทนี้ที่ถึงรอบทบทวนแล้ว — ขั้นต่ำ (ลืมง่าย) มาก่อน แล้วค่อยเรียงตามวันนัด
async function dueQuestionIds(userId, chapterId) {
  const rows = await db
    .prepare(
      `SELECT r.question_id AS id FROM review_items r
       JOIN quiz_questions q ON q.id = r.question_id AND q.enabled = 1
       WHERE r.user_id = ? AND r.chapter_id = ? AND r.due_at <= datetime('now')
       ORDER BY r.stage ASC, r.due_at ASC`
    )
    .all(userId, chapterId);
  return rows.map((r) => r.id);
}

// สรุปสำหรับหน้าแรก/แผนที่เกม: วันนี้ถึงรอบกี่ข้อ (แยกบท) + นัดครั้งถัดไป
async function reviewStatus(userId) {
  const rows = await db
    .prepare(
      `SELECT c.chapter_number, c.title,
              SUM(CASE WHEN r.due_at <= datetime('now') THEN 1 ELSE 0 END) AS due,
              SUM(CASE WHEN r.due_at IS NULL THEN 1 ELSE 0 END) AS mastered,
              COUNT(*) AS total,
              MIN(CASE WHEN r.due_at > datetime('now') THEN r.due_at END) AS next_due_at
       FROM review_items r
       JOIN quiz_questions q ON q.id = r.question_id AND q.enabled = 1
       JOIN chapters c ON c.id = r.chapter_id
       WHERE r.user_id = ?
       GROUP BY c.id ORDER BY c.chapter_number ASC`
    )
    .all(userId);
  const chapters = rows.map((r) => ({
    chapterNumber: r.chapter_number,
    title: r.title,
    due: r.due || 0,
    mastered: r.mastered || 0,
    total: r.total,
  }));
  const next = rows.map((r) => r.next_due_at).filter(Boolean).sort()[0] || null;
  return {
    dueTotal: chapters.reduce((a, c) => a + c.due, 0),
    masteredTotal: chapters.reduce((a, c) => a + c.mastered, 0),
    scheduledTotal: chapters.reduce((a, c) => a + c.total, 0),
    nextDueAt: next ? next.replace(" ", "T") + "Z" : null,
    intervalDays: INTERVAL_DAYS,
    chapters,
  };
}

module.exports = { INTERVAL_DAYS, MASTERED_STAGE, recordReview, dueQuestionIds, reviewStatus };
