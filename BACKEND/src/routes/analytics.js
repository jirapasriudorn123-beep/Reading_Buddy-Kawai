const express = require("express");
const db = require("../db/database");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// คำนวณเวลาที่อ่านจริง (วินาที) จาก started_at/ended_at ของเซสชันที่จบแล้ว (status = completed)
// ใช้ julianday() ของ SQLite แปลงผลต่างวันเป็นวินาที
const ELAPSED_SECONDS_SQL = `CAST((julianday(ended_at) - julianday(started_at)) * 86400 AS INTEGER)`;

// ---------- GET /api/analytics/today-progress ----------
// เทียบเวลาอ่านจริงวันนี้ กับเป้าหมายที่ตั้งไว้ (goal)
router.get("/today-progress", requireAuth, (req, res) => {
  const goal = db
    .prepare("SELECT goal_minutes, goal_seconds FROM reading_goals WHERE user_id = ?")
    .get(req.user.id);

  const goalSeconds = goal ? goal.goal_minutes * 60 + goal.goal_seconds : 0;

  // "วันนี้" อ้างอิงตามวันที่ของ server (UTC) เพื่อความง่าย
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(${ELAPSED_SECONDS_SQL}), 0) AS totalSeconds
       FROM reading_sessions
       WHERE user_id = ? AND status = 'completed' AND date(started_at) = date('now')`
    )
    .get(req.user.id);

  const readSecondsToday = row.totalSeconds || 0;
  const percent = goalSeconds > 0 ? Math.min(100, Math.round((readSecondsToday / goalSeconds) * 100)) : 0;

  return res.json({ goalSeconds, readSecondsToday, percent });
});

// ---------- GET /api/analytics/weekly-progress?weeks=5 ----------
// เทียบเวลาอ่านจริงรวมรายสัปดาห์ กับเป้าหมายรายสัปดาห์ (เป้าหมายรายวัน x 7) ย้อนหลัง N สัปดาห์ เรียงเก่า -> ใหม่
router.get("/weekly-progress", requireAuth, (req, res) => {
  let weeks = Number(req.query.weeks) || 5;
  weeks = Math.min(12, Math.max(1, weeks));

  const goal = db
    .prepare("SELECT goal_minutes, goal_seconds FROM reading_goals WHERE user_id = ?")
    .get(req.user.id);
  const dailyGoalSeconds = goal ? goal.goal_minutes * 60 + goal.goal_seconds : 0;
  const weeklyGoalSeconds = dailyGoalSeconds * 7;

  const result = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const startOffset = w * 7 + 6; // วันที่เก่าสุดของสัปดาห์นี้ (นับถอยหลังจากวันนี้)
    const endOffset = w * 7; // วันที่ใหม่สุดของสัปดาห์นี้
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(${ELAPSED_SECONDS_SQL}), 0) AS totalSeconds
         FROM reading_sessions
         WHERE user_id = ? AND status = 'completed'
           AND date(started_at) BETWEEN date('now', ?) AND date('now', ?)`
      )
      .get(req.user.id, `-${startOffset} days`, `-${endOffset} days`);

    const startDate = db.prepare("SELECT date('now', ?) AS d").get(`-${startOffset} days`).d;
    const endDate = db.prepare("SELECT date('now', ?) AS d").get(`-${endOffset} days`).d;

    result.push({
      weeksAgo: w,
      readSeconds: row.totalSeconds || 0,
      goalSeconds: weeklyGoalSeconds,
      startDate,
      endDate,
    });
  }

  return res.json({ weeks: result });
});

// ---------- GET /api/analytics/focus-by-chapter ----------
// เวลาอ่านจริงรวมทั้งหมด แยกตามแต่ละ chapter (ใช้ทำ pie/bar chart การจำแนกเวลาโฟกัส)
router.get("/focus-by-chapter", requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT c.chapter_number, c.title,
              COALESCE(SUM(${ELAPSED_SECONDS_SQL}), 0) AS totalSeconds
       FROM chapters c
       LEFT JOIN reading_sessions rs
         ON rs.chapter_id = c.id AND rs.user_id = ? AND rs.status = 'completed'
       GROUP BY c.id
       ORDER BY c.chapter_number ASC`
    )
    .all(req.user.id);

  return res.json({ chapters: rows });
});

// ---------- GET /api/analytics/trend?days=7 ----------
// แนวโน้มเวลาอ่านย้อนหลัง N วัน (ค่าเริ่มต้น 7 วัน, สูงสุด 30 วัน)
router.get("/trend", requireAuth, (req, res) => {
  let days = Number(req.query.days) || 7;
  days = Math.min(30, Math.max(1, days));

  // ดึงผลรวมเวลาอ่านต่อวันจากฐานข้อมูล (เฉพาะวันที่มีข้อมูลจริง)
  const rows = db
    .prepare(
      `SELECT date(started_at) AS day, SUM(${ELAPSED_SECONDS_SQL}) AS totalSeconds
       FROM reading_sessions
       WHERE user_id = ? AND status = 'completed'
         AND date(started_at) >= date('now', ?)
       GROUP BY date(started_at)`
    )
    .all(req.user.id, `-${days - 1} days`);

  const byDate = {};
  rows.forEach((r) => {
    byDate[r.day] = r.totalSeconds;
  });

  // เติมวันที่ไม่มีข้อมูลให้เป็น 0 เพื่อให้กราฟเส้นต่อเนื่องสวยงาม
  const trend = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = db.prepare("SELECT date('now', ?) AS d").get(`-${i} days`).d;
    trend.push({ date: d, totalSeconds: byDate[d] || 0 });
  }

  return res.json({ trend });
});

module.exports = router;
