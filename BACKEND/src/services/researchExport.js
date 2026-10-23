const db = require("../db/database");
const { INTERVAL_DAYS, MASTERED_STAGE } = require("./spacedReview");

// ================== ส่งออกข้อมูลวิจัย (Learning Analytics) เป็น CSV ==================
// 3 ไฟล์ เปิดใน Excel / Google Sheets / SPSS ได้ (UTF-8 + BOM ภาษาไทยไม่เพี้ยน) ไม่มีชื่อ/อีเมล ใช้รหัสผู้ใช้แทน
//   users    — 1 แถว = ผู้ใช้ 1 คน (เทียบระหว่างคน เช่น ดูแลหมาบ่อย vs อ่านนาน)
//   days     — 1 แถว = ผู้ใช้ 1 คน × 1 วันที่เข้าใช้ (retention, เทียบวันที่ดูแลหมากับวันที่ไม่ได้ดูแลในคนเดียวกัน)
//   sessions — 1 แถว = รอบอ่าน 1 รอบที่อ่านจบ (ช่วงเวลาที่อ่าน, ความยาวรอบ, รอบที่ถาม AI vs ไม่ได้ถาม)
//   reviews  — 1 แถว = ตอบคำถามบทเรียน 1 ครั้งใน post/เกม พร้อมขั้นทบทวน (จำได้แค่ไหนเมื่อเว้นไป 1/3/7/14 วัน)
//   user-key — ตารางจับคู่รหัสผู้ใช้ ↔ ชื่อผู้ใช้/อีเมล (มีข้อมูลส่วนบุคคล เก็บแยกจากข้อมูลวิจัย ห้ามแนบในเล่ม/ส่งต่อ)
// เวลาทั้งหมดเป็นเวลาไทย (UTC+7) | ไม่นับบัญชีแอดมิน
// รวมเฉพาะผู้ใช้ที่ยินยอมให้ใช้ข้อมูลเพื่อการวิจัย (users.research_consent = 1 ดู services/consent.js)

const TZ_MS = 7 * 60 * 60 * 1000;
// ผู้ร่วมวิจัย = ผู้ใช้ทั่วไป (ไม่ใช่แอดมิน) ที่ยินยอมให้ใช้ข้อมูลเพื่อการวิจัย
const PARTICIPANT_SQL = "is_admin = 0 AND research_consent = 1";
const STREAK_MIN_SECONDS = 10 * 60;
const PAGE_VIEWED_MIN_SECONDS = 5; // ตรงกับ routes/sessions.js: เปิดหน้านั้น ≥ 5 วินาที นับว่าเปิดอ่าน // ตรงกับ services/petCare.js: วันที่อ่านรวม ≥ 10 นาที นับเป็นวันอ่าน
const PASS_RATIO = 0.8;

// คะแนน post ครั้งแรกของชุด (ก่อนทำซ้ำจนผ่าน) — ชุดเก่าก่อนมีคอลัมน์นี้ใช้ post_score ของชุดที่จบแล้ว
function firstPostScore(t) {
  if (t.first_post_score !== null && t.first_post_score !== undefined) return t.first_post_score;
  return t.status === "completed" ? t.post_score : null;
}

function thaiDateTime(sqliteDatetime) {
  if (!sqliteDatetime) return "";
  return new Date(new Date(sqliteDatetime + "Z").getTime() + TZ_MS).toISOString().slice(0, 19).replace("T", " ");
}

function thaiDate(sqliteDatetime) {
  return thaiDateTime(sqliteDatetime).slice(0, 10);
}

function daysBetween(fromDate, toDate) {
  return Math.round((Date.parse(toDate) - Date.parse(fromDate)) / 86400000);
}

// 1 = จันทร์ ... 7 = อาทิตย์
function weekdayOf(date) {
  const d = new Date(date + "T00:00:00Z").getUTCDay();
  return d === 0 ? 7 : d;
}

const round1 = (n) => Math.round(n * 10) / 10;
const pct = (num, den) => (den > 0 ? round1((num / den) * 100) : "");
const avg = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);

// วันอ่านติดกันที่ยาวที่สุด (dates เรียงเก่า → ใหม่)
function longestStreak(dates) {
  let longest = 0;
  let run = 0;
  for (let i = 0; i < dates.length; i++) {
    run = i > 0 && daysBetween(dates[i - 1], dates[i]) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  return longest;
}

function userCode(id) {
  return `U${String(id).padStart(4, "0")}`;
}

function toCsv(columns, rows) {
  const escape = (value) => {
    if (value === null || value === undefined) return "";
    const s = String(value);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.join(","), ...rows.map((row) => columns.map((c) => escape(row[c])).join(","))];
  return "﻿" + lines.join("\r\n") + "\r\n";
}

// group rows ตาม key → Map(key → rows[])
function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const k = typeof key === "function" ? key(row) : row[key];
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(row);
  }
  return map;
}

// ---------- ดึงข้อมูลดิบทั้งหมดของผู้ใช้ทั่วไป ----------
async function loadRaw() {
  const nonAdmin = `user_id IN (SELECT id FROM users WHERE ${PARTICIPANT_SQL})`;
  const [users, pets, chapters, sessions, tests, testAnswers, chats, petLog, battles, answers, purchases, coupons, pageTime, reviewItems, reviewLog] =
    await Promise.all([
      db.prepare(`SELECT id, created_at, coins FROM users WHERE ${PARTICIPANT_SQL} ORDER BY id`).all(),
      db.prepare(`SELECT user_id, care_points, happiness FROM pets WHERE ${nonAdmin}`).all(),
      db.prepare("SELECT id, chapter_number FROM chapters").all(),
      db
        .prepare(
          `SELECT id, user_id, chapter_id, chapter_test_id, planned_read_seconds, read_seconds, away_seconds, idle_seconds,
                  coins_earned, coins_pending, started_at, ended_at, pdf_total_pages
           FROM reading_sessions WHERE status = 'completed' AND ${nonAdmin} ORDER BY started_at`
        )
        .all(),
      db.prepare(`SELECT * FROM chapter_tests WHERE ${nonAdmin}`).all(),
      db
        .prepare(
          `SELECT t.user_id, q.pre_answered_at, q.post_answered_at
           FROM chapter_test_questions q JOIN chapter_tests t ON t.id = q.test_id
           WHERE t.user_id IN (SELECT id FROM users WHERE ${PARTICIPANT_SQL})`
        )
        .all(),
      db.prepare(`SELECT user_id, source, created_at, reading_session_id FROM chat_history WHERE ${nonAdmin}`).all(),
      db.prepare(`SELECT user_id, action, is_free, created_at FROM pet_action_log WHERE ${nonAdmin}`).all(),
      db.prepare(`SELECT user_id, status, started_at FROM game_battles WHERE status != 'cancelled' AND ${nonAdmin}`).all(),
      db.prepare(`SELECT user_id, category, correct, created_at FROM quiz_answer_log WHERE ${nonAdmin}`).all(),
      db.prepare(`SELECT user_id, price, purchased_at AS created_at FROM purchase_log WHERE ${nonAdmin}`).all(),
      db.prepare(`SELECT user_id, COUNT(*) AS n FROM user_coupons WHERE ${nonAdmin} GROUP BY user_id`).all(),
      db.prepare("SELECT session_id, page, seconds FROM reading_page_time").all(),
      db.prepare(`SELECT user_id, stage FROM review_items WHERE ${nonAdmin}`).all(),
      db.prepare(`SELECT * FROM review_log WHERE ${nonAdmin} ORDER BY id`).all(),
    ]);
  return { users, pets, chapters, sessions, tests, testAnswers, chats, petLog, battles, answers, purchases, coupons, pageTime, reviewItems, reviewLog };
}

// นับกิจกรรมรายวันของแต่ละคน: Map(userId → Map(date → counters))
function buildDailyActivity(raw) {
  const byUser = new Map();
  const bump = (userId, sqliteDatetime, field, amount = 1) => {
    if (!sqliteDatetime) return;
    const date = thaiDate(sqliteDatetime);
    if (!byUser.has(userId)) byUser.set(userId, new Map());
    const days = byUser.get(userId);
    if (!days.has(date)) {
      days.set(date, {
        reading_rounds: 0,
        reading_seconds: 0,
        test_answers: 0,
        pet_visits: 0,
        pet_care_free: 0,
        pet_care_item: 0,
        ai_questions: 0,
        chat_messages: 0,
        game_battles: 0,
        game_subject_answers: 0,
        game_subject_correct: 0,
        purchases: 0,
      });
    }
    days.get(date)[field] += amount;
  };

  for (const s of raw.sessions) {
    bump(s.user_id, s.started_at, "reading_rounds");
    bump(s.user_id, s.started_at, "reading_seconds", s.read_seconds || 0);
  }
  for (const a of raw.testAnswers) {
    bump(a.user_id, a.pre_answered_at, "test_answers");
    bump(a.user_id, a.post_answered_at, "test_answers");
  }
  for (const c of raw.chats) {
    bump(c.user_id, c.created_at, "chat_messages");
    if (c.source === "gemini") bump(c.user_id, c.created_at, "ai_questions");
  }
  for (const p of raw.petLog) {
    const field = p.action === "visit" ? "pet_visits" : p.is_free ? "pet_care_free" : "pet_care_item";
    bump(p.user_id, p.created_at, field);
  }
  for (const b of raw.battles) bump(b.user_id, b.started_at, "game_battles");
  for (const a of raw.answers) {
    if (a.category !== "subject") continue; // คำถามพันธุ์หมาไม่นับเป็นคะแนนการเรียน
    bump(a.user_id, a.created_at, "game_subject_answers");
    if (a.correct) bump(a.user_id, a.created_at, "game_subject_correct");
  }
  for (const p of raw.purchases) bump(p.user_id, p.created_at, "purchases");
  return byUser;
}

// ---------- users.csv ----------
const USER_COLUMNS = [
  "user_code",
  "registered_at",
  "active_days",
  "first_active_date",
  "last_active_date",
  "last_active_day_index",
  "reading_days",
  "longest_reading_streak",
  "reading_rounds",
  "reading_minutes",
  "avg_round_minutes",
  "rounds_stopped_early",
  "reading_minutes_per_active_day",
  "chapters_pretested",
  "chapters_posttested",
  "avg_pre_score_pct",
  "avg_post_score_pct",
  "avg_gain_pct",
  "chapters_passed",
  "pet_visits",
  "pet_care_free",
  "pet_care_item",
  "pet_care_free_per_active_day",
  "pet_level",
  "pet_happiness_now",
  "ai_questions",
  "ai_questions_per_active_day",
  "chat_messages",
  "game_battles",
  "game_battles_won",
  "game_subject_answers",
  "game_subject_correct_pct",
  "review_items",
  "review_mastered",
  "review_due_answers",
  "review_due_correct_pct",
  "coins_from_reading",
  "coins_post_bonus",
  "coins_now",
  "purchases",
  "coins_spent",
  "coupons_redeemed",
];

async function buildUsers() {
  const raw = await loadRaw();
  const daily = buildDailyActivity(raw);
  const sessionsByUser = groupBy(raw.sessions, "user_id");
  const testsByUser = groupBy(raw.tests, "user_id");
  const battlesByUser = groupBy(raw.battles, "user_id");
  const purchasesByUser = groupBy(raw.purchases, "user_id");
  const petByUser = new Map(raw.pets.map((p) => [p.user_id, p]));
  const couponsByUser = new Map(raw.coupons.map((c) => [c.user_id, c.n]));
  const reviewItemsByUser = groupBy(raw.reviewItems, "user_id");
  const reviewLogByUser = groupBy(raw.reviewLog, "user_id");

  const rows = raw.users.map((u) => {
    const days = daily.get(u.id) || new Map();
    const dates = [...days.keys()].sort();
    const totals = [...days.values()].reduce((acc, d) => {
      for (const [k, v] of Object.entries(d)) acc[k] = (acc[k] || 0) + v;
      return acc;
    }, {});
    const activeDays = dates.length;
    const perDay = (n) => (activeDays ? round1((n || 0) / activeDays) : "");

    const sessions = sessionsByUser.get(u.id) || [];
    const readSeconds = sessions.reduce((a, s) => a + (s.read_seconds || 0), 0);
    const tests = testsByUser.get(u.id) || [];
    // คะแนนก่อน/หลังอ่าน ใช้ชุดแรกของแต่ละบท (ชุดที่มีทั้ง pre และ post) — ชุดที่อ่านซ้ำไม่มี pre
    const firstTests = tests.filter((t) => t.attempt === 1 && t.total > 0);
    const preList = firstTests.filter((t) => t.pre_score !== null).map((t) => (t.pre_score / t.total) * 100);
    const postList = firstTests.filter((t) => firstPostScore(t) !== null).map((t) => (firstPostScore(t) / t.total) * 100);
    const gainList = firstTests
      .filter((t) => firstPostScore(t) !== null && t.pre_score !== null)
      .map((t) => ((firstPostScore(t) - t.pre_score) / t.total) * 100);
    const bestByChapter = new Map();
    for (const t of tests.filter((t) => t.status === "completed")) {
      const ratio = t.total > 0 ? t.post_score / t.total : 1;
      bestByChapter.set(t.chapter_id, Math.max(bestByChapter.get(t.chapter_id) ?? 0, ratio));
    }
    const battles = battlesByUser.get(u.id) || [];
    const purchases = purchasesByUser.get(u.id) || [];
    const pet = petByUser.get(u.id);
    const reviewItems = reviewItemsByUser.get(u.id) || [];
    const dueReviews = (reviewLogByUser.get(u.id) || []).filter((r) => r.was_due && r.stage_before > 0);
    const fmt = (v) => (v === null ? "" : round1(v));

    return {
      user_code: userCode(u.id),
      registered_at: thaiDateTime(u.created_at),
      active_days: activeDays,
      first_active_date: dates[0] || "",
      last_active_date: dates[dates.length - 1] || "",
      last_active_day_index: dates.length ? daysBetween(thaiDate(u.created_at), dates[dates.length - 1]) : "",
      reading_days: [...days.values()].filter((d) => d.reading_rounds > 0).length,
      longest_reading_streak: longestStreak(
        dates.filter((date) => days.get(date).reading_seconds >= STREAK_MIN_SECONDS)
      ),
      reading_rounds: sessions.length,
      reading_minutes: round1(readSeconds / 60),
      avg_round_minutes: sessions.length ? round1(readSeconds / 60 / sessions.length) : "",
      rounds_stopped_early: sessions.filter((s) => (s.read_seconds || 0) < s.planned_read_seconds).length,
      reading_minutes_per_active_day: activeDays ? round1(readSeconds / 60 / activeDays) : "",
      chapters_pretested: preList.length,
      chapters_posttested: postList.length,
      avg_pre_score_pct: fmt(avg(preList)),
      avg_post_score_pct: fmt(avg(postList)),
      avg_gain_pct: fmt(avg(gainList)),
      chapters_passed: [...bestByChapter.values()].filter((r) => r >= PASS_RATIO - 1e-9).length,
      pet_visits: totals.pet_visits || 0,
      pet_care_free: totals.pet_care_free || 0,
      pet_care_item: totals.pet_care_item || 0,
      pet_care_free_per_active_day: perDay(totals.pet_care_free),
      pet_level: pet ? pet.care_points : "",
      pet_happiness_now: pet ? pet.happiness : "",
      ai_questions: totals.ai_questions || 0,
      ai_questions_per_active_day: perDay(totals.ai_questions),
      chat_messages: totals.chat_messages || 0,
      game_battles: battles.length,
      game_battles_won: battles.filter((b) => b.status === "won").length,
      game_subject_answers: totals.game_subject_answers || 0,
      game_subject_correct_pct: pct(totals.game_subject_correct || 0, totals.game_subject_answers || 0),
      review_items: reviewItems.length,
      review_mastered: reviewItems.filter((r) => r.stage >= MASTERED_STAGE).length,
      review_due_answers: dueReviews.length,
      review_due_correct_pct: pct(dueReviews.filter((r) => r.correct).length, dueReviews.length),
      coins_from_reading: sessions.filter((s) => !s.coins_pending).reduce((a, s) => a + (s.coins_earned || 0), 0),
      coins_post_bonus: tests.reduce((a, t) => a + (t.coins_bonus || 0), 0),
      coins_now: u.coins,
      purchases: purchases.length,
      coins_spent: purchases.reduce((a, p) => a + (p.price || 0), 0),
      coupons_redeemed: couponsByUser.get(u.id) || 0,
    };
  });
  return { columns: USER_COLUMNS, rows };
}

// ---------- days.csv ----------
const DAY_COLUMNS = [
  "user_code",
  "date",
  "day_index",
  "weekday",
  "reading_rounds",
  "reading_minutes",
  "test_answers",
  "pet_visits",
  "pet_care_free",
  "pet_care_item",
  "ai_questions",
  "chat_messages",
  "game_battles",
  "game_subject_answers",
  "game_subject_correct",
  "purchases",
];

async function buildDays() {
  const raw = await loadRaw();
  const daily = buildDailyActivity(raw);
  const rows = [];
  for (const u of raw.users) {
    const days = daily.get(u.id);
    if (!days) continue;
    const registered = thaiDate(u.created_at);
    for (const date of [...days.keys()].sort()) {
      const d = days.get(date);
      rows.push({
        user_code: userCode(u.id),
        date,
        day_index: daysBetween(registered, date),
        weekday: weekdayOf(date),
        ...d,
        reading_minutes: round1(d.reading_seconds / 60),
      });
    }
  }
  return { columns: DAY_COLUMNS, rows };
}

// ---------- sessions.csv ----------
const SESSION_COLUMNS = [
  "user_code",
  "session_id",
  "chapter_number",
  "chapter_attempt",
  "started_at",
  "date",
  "hour",
  "weekday",
  "day_index",
  "planned_minutes",
  "read_minutes",
  "away_minutes",
  "idle_minutes",
  "stopped_early",
  "coins_time",
  "coins_paid",
  "ai_questions_during",
  "chat_messages_during",
  "pdf_total_pages",
  "pages_viewed",
  "first_page_viewed",
  "last_page_viewed",
  "page_seconds_tracked",
  "chapter_pre_score",
  "chapter_post_score",
  "chapter_total",
];

async function buildSessions() {
  const raw = await loadRaw();
  const chapterNumber = new Map(raw.chapters.map((c) => [c.id, c.chapter_number]));
  const testById = new Map(raw.tests.map((t) => [t.id, t]));
  const registeredBy = new Map(raw.users.map((u) => [u.id, thaiDate(u.created_at)]));
  const pagesBySession = groupBy(raw.pageTime, "session_id");
  const chatsBySession = groupBy(
    raw.chats.filter((c) => c.reading_session_id),
    "reading_session_id"
  );

  const rows = raw.sessions
    .filter((s) => registeredBy.has(s.user_id))
    .map((s) => {
      const started = thaiDateTime(s.started_at);
      const date = started.slice(0, 10);
      const test = s.chapter_test_id ? testById.get(s.chapter_test_id) : null;
      const chats = chatsBySession.get(s.id) || [];
      const pageRows = pagesBySession.get(s.id) || [];
      const viewedPages = pageRows.filter((p) => p.seconds >= PAGE_VIEWED_MIN_SECONDS).map((p) => p.page);
      return {
        user_code: userCode(s.user_id),
        session_id: s.id,
        chapter_number: chapterNumber.get(s.chapter_id) ?? "",
        chapter_attempt: test ? test.attempt : "",
        started_at: started,
        date,
        hour: Number(started.slice(11, 13)),
        weekday: weekdayOf(date),
        day_index: daysBetween(registeredBy.get(s.user_id), date),
        planned_minutes: round1(s.planned_read_seconds / 60),
        read_minutes: round1((s.read_seconds || 0) / 60),
        // away_seconds รวมช่วงไม่ขยับไว้ด้วย — แยกออกมาให้ away_minutes เป็นเวลาที่สลับไปหน้าอื่นอย่างเดียว
        away_minutes: round1(Math.max(0, (s.away_seconds || 0) - (s.idle_seconds || 0)) / 60),
        idle_minutes: round1((s.idle_seconds || 0) / 60),
        stopped_early: (s.read_seconds || 0) < s.planned_read_seconds ? 1 : 0,
        coins_time: s.coins_earned,
        coins_paid: s.coins_pending ? 0 : 1,
        ai_questions_during: chats.filter((c) => c.source === "gemini").length,
        chat_messages_during: chats.length,
        pdf_total_pages: s.pdf_total_pages ?? "",
        pages_viewed: viewedPages.length,
        first_page_viewed: viewedPages.length ? Math.min(...viewedPages) : "",
        last_page_viewed: viewedPages.length ? Math.max(...viewedPages) : "",
        page_seconds_tracked: pageRows.reduce((a, p) => a + p.seconds, 0),
        chapter_pre_score: test && test.pre_score !== null ? test.pre_score : "",
        chapter_post_score: test && firstPostScore(test) !== null ? firstPostScore(test) : "",
        chapter_total: test ? test.total : "",
      };
    })
    .sort((a, b) => (a.user_code === b.user_code ? a.started_at.localeCompare(b.started_at) : a.user_code.localeCompare(b.user_code)));
  return { columns: SESSION_COLUMNS, rows };
}

// ---------- reviews.csv ----------
// stage_before: ขั้นก่อนตอบ (ว่าง = ยังไม่มีนัด, 0 = เพิ่งตอบผิด, 1-4 = นัดหลังตอบถูกครั้งก่อน interval_days วัน, 5 = จำได้แล้ว)
// was_due: ตอบตอนถึงรอบทบทวนแล้ว — ดู % ถูกของแถว was_due=1 แยกตาม interval_days = ความจำเมื่อเว้นไป 1/3/7/14 วัน
const REVIEW_COLUMNS = [
  "user_code",
  "answered_at",
  "chapter_number",
  "question_id",
  "source",
  "stage_before",
  "interval_days",
  "was_due",
  "correct",
  "stage_after",
];

async function buildReviews() {
  const raw = await loadRaw();
  const chapterNumber = new Map(raw.chapters.map((c) => [c.id, c.chapter_number]));
  const intervalOf = (stage) => (stage >= 1 && stage <= INTERVAL_DAYS.length ? INTERVAL_DAYS[stage - 1] : "");
  const rows = raw.reviewLog.map((r) => ({
    user_code: userCode(r.user_id),
    answered_at: thaiDateTime(r.created_at),
    chapter_number: chapterNumber.get(r.chapter_id) ?? "",
    question_id: r.question_id,
    source: r.source,
    stage_before: r.stage_before ?? "",
    interval_days: intervalOf(r.stage_before),
    was_due: r.was_due,
    correct: r.correct,
    stage_after: r.stage_after ?? "",
  }));
  return { columns: REVIEW_COLUMNS, rows };
}

// ---------- user-key.csv ----------
// "กุญแจ" สำหรับย้อนดูว่ารหัสไหนเป็นใคร (pseudonymization) — ข้อมูลวิจัย 4 ชุดข้างบนยังไม่มีชื่อเหมือนเดิม
const USER_KEY_COLUMNS = ["user_code", "username", "email", "registered_at"];

async function buildUserKey() {
  const users = await db
    .prepare(`SELECT id, username, email, created_at FROM users WHERE ${PARTICIPANT_SQL} ORDER BY id`)
    .all();
  const rows = users.map((u) => ({
    user_code: userCode(u.id),
    username: u.username,
    email: u.email,
    registered_at: thaiDateTime(u.created_at),
  }));
  return { columns: USER_KEY_COLUMNS, rows };
}

// ข้อมูลแต่ละชุดเป็น { columns, rows } — ใช้ทั้งดาวน์โหลด CSV และแสดงเป็นตารางในหน้าแอดมิน (ข้อมูลวิจัย)
const DATASETS = {
  users: buildUsers,
  days: buildDays,
  sessions: buildSessions,
  reviews: buildReviews,
  "user-key": buildUserKey,
};

async function buildCsv(kind) {
  const { columns, rows } = await DATASETS[kind]();
  return toCsv(columns, rows);
}

module.exports = { DATASETS, buildCsv };
