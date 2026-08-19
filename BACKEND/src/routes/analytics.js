const express = require("express");
const db = require("../db/database");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const ELAPSED_SECONDS_SQL = `CAST((julianday(ended_at) - julianday(started_at)) * 86400 AS INTEGER)`;

// Backend timestamp เป็น UTC (datetime('now') ของ SQLite) แต่ user เป็นคนไทย (UTC+7)
// ถ้าเทียบวันด้วย date('now') ตรงๆ user ที่อ่านช่วง 00:00-07:00 ไทยจะโดนนับเป็นเมื่อวาน
// ทั้ง started_at และ 'now' จึงต้อง shift +7 ชม.ก่อนเอามาตัดวันเสมอ ให้เป็น "วันในเวลาไทย"
const TZ_OFFSET = "+7 hours";
const DAY_NOW = `date('now', '${TZ_OFFSET}')`;
const DAY_STARTED = `date(started_at, '${TZ_OFFSET}')`;

// ---------- GET /api/analytics/today-progress ----------
router.get("/today-progress", requireAuth, async (req, res, next) => {
  try {
    const goal = await db
      .prepare("SELECT goal_minutes, goal_seconds FROM reading_goals WHERE user_id = ?")
      .get(req.user.id);

    const goalSeconds = goal ? goal.goal_minutes * 60 + goal.goal_seconds : 0;

    const row = await db
      .prepare(
        `SELECT COALESCE(SUM(${ELAPSED_SECONDS_SQL}), 0) AS totalSeconds
         FROM reading_sessions
         WHERE user_id = ? AND status = 'completed' AND ${DAY_STARTED} = ${DAY_NOW}`
      )
      .get(req.user.id);

    const readSecondsToday = row.totalSeconds || 0;
    const percent = goalSeconds > 0 ? Math.min(100, Math.round((readSecondsToday / goalSeconds) * 100)) : 0;

    return res.json({ goalSeconds, readSecondsToday, percent });
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/analytics/weekly-progress?weeks=5 ----------
router.get("/weekly-progress", requireAuth, async (req, res, next) => {
  try {
    let weeks = Number(req.query.weeks) || 5;
    weeks = Math.min(12, Math.max(1, weeks));

    const goal = await db
      .prepare("SELECT goal_minutes, goal_seconds FROM reading_goals WHERE user_id = ?")
      .get(req.user.id);
    const dailyGoalSeconds = goal ? goal.goal_minutes * 60 + goal.goal_seconds : 0;
    const weeklyGoalSeconds = dailyGoalSeconds * 7;

    const result = [];
    for (let w = weeks - 1; w >= 0; w--) {
      const startOffset = w * 7 + 6;
      const endOffset = w * 7;
      const row = await db
        .prepare(
          `SELECT COALESCE(SUM(${ELAPSED_SECONDS_SQL}), 0) AS totalSeconds
           FROM reading_sessions
           WHERE user_id = ? AND status = 'completed'
             AND ${DAY_STARTED} BETWEEN date('now', ?, '${TZ_OFFSET}') AND date('now', ?, '${TZ_OFFSET}')`
        )
        .get(req.user.id, `-${startOffset} days`, `-${endOffset} days`);

      const startDateRow = await db.prepare(`SELECT date('now', ?, '${TZ_OFFSET}') AS d`).get(`-${startOffset} days`);
      const endDateRow = await db.prepare(`SELECT date('now', ?, '${TZ_OFFSET}') AS d`).get(`-${endOffset} days`);

      result.push({
        weeksAgo: w,
        readSeconds: row.totalSeconds || 0,
        goalSeconds: weeklyGoalSeconds,
        startDate: startDateRow.d,
        endDate: endDateRow.d,
      });
    }

    return res.json({ weeks: result });
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/analytics/focus-by-chapter ----------
router.get("/focus-by-chapter", requireAuth, async (req, res, next) => {
  try {
    const rows = await db
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
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/analytics/trend?days=7 ----------
router.get("/trend", requireAuth, async (req, res, next) => {
  try {
    let days = Number(req.query.days) || 7;
    days = Math.min(30, Math.max(1, days));

    const rows = await db
      .prepare(
        `SELECT ${DAY_STARTED} AS day, SUM(${ELAPSED_SECONDS_SQL}) AS totalSeconds
         FROM reading_sessions
         WHERE user_id = ? AND status = 'completed'
           AND ${DAY_STARTED} >= date('now', ?, '${TZ_OFFSET}')
         GROUP BY ${DAY_STARTED}`
      )
      .all(req.user.id, `-${days - 1} days`);

    const byDate = {};
    rows.forEach((r) => {
      byDate[r.day] = r.totalSeconds;
    });

    const trend = [];
    for (let i = days - 1; i >= 0; i--) {
      const dRow = await db.prepare(`SELECT date('now', ?, '${TZ_OFFSET}') AS d`).get(`-${i} days`);
      trend.push({ date: dRow.d, totalSeconds: byDate[dRow.d] || 0 });
    }

    return res.json({ trend });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
