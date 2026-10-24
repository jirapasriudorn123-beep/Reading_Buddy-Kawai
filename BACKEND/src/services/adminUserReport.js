// ================== รายงานรายคน (หน้า adminuser-detail.html) ==================
// รวมข้อมูลของผู้ใช้คนเดียวไว้ในคำขอเดียว: สรุปการอ่าน, คะแนนก่อน/หลังอ่านรายบท, การทบทวนตามระยะที่เว้น,
// รอบการอ่านล่าสุด, ด่านมินิเกมที่ผ่าน, น้องหมา และการถาม AI — เวลาไทย (+7 ชั่วโมง) เหมือนไฟล์ข้อมูลวิจัย
const db = require("../db/database");
const { INTERVAL_DAYS, MASTERED_STAGE } = require("./spacedReview");

const STAGES_PER_WORLD = 5; // ต้องตรงกับ GAME_STAGES_PER_WORLD ใน routes/game.js
const PASS_RATIO = 0.8; // ต้องตรงกับ PASS_RATIO ใน services/chapterTests.js
const PAGE_VIEWED_MIN_SECONDS = 5; // นับว่า "เปิดอ่าน" เมื่ออยู่หน้านั้นอย่างน้อยเท่านี้
const THAI = "+7 hours";

const pct = (part, total) => (total > 0 ? Math.round((part / total) * 100) : 0);
const round1 = (n) => Math.round(n * 10) / 10;

// ---------- ตัวผู้ใช้ + สรุปการอ่าน ----------
async function buildProfile(userId) {
  const [user, reading, streak] = await Promise.all([
    db
      .prepare(
        `SELECT id, username, email, coins, research_consent,
                datetime(created_at, '${THAI}') registered_at,
                datetime(last_active_at, '${THAI}') last_active_at
         FROM users WHERE id = ? AND is_admin = 0`
      )
      .get(userId),
    db
      .prepare(
        `SELECT COUNT(*) rounds,
                COALESCE(SUM(read_seconds), 0) seconds,
                COALESCE(SUM(CASE WHEN read_seconds < planned_read_seconds THEN 1 ELSE 0 END), 0) stopped_early,
                COUNT(DISTINCT date(started_at, '${THAI}')) reading_days
         FROM reading_sessions WHERE user_id = ? AND status = 'completed'`
      )
      .get(userId),
    db
      .prepare(
        `SELECT DISTINCT date(started_at, '${THAI}') day FROM reading_sessions
         WHERE user_id = ? AND status = 'completed' ORDER BY day`
      )
      .all(userId),
  ]);
  if (!user) return null;

  // วันที่เข้าใช้ = วันที่มีกิจกรรมอะไรก็ได้ (อ่าน / เกม / ถาม AI / ดูแลน้องหมา)
  const activeDays = await db
    .prepare(
      `SELECT COUNT(DISTINCT day) c FROM (
         SELECT date(started_at, '${THAI}') day FROM reading_sessions WHERE user_id = ?
         UNION SELECT date(started_at, '${THAI}') FROM game_battles WHERE user_id = ?
         UNION SELECT date(created_at, '${THAI}') FROM chat_history WHERE user_id = ?
         UNION SELECT date(created_at, '${THAI}') FROM pet_action_log WHERE user_id = ?
       )`
    )
    .get(userId, userId, userId, userId);

  // อ่านติดกันนานสุด (วัน)
  let longest = 0;
  let run = 0;
  let prev = null;
  for (const { day } of streak) {
    const d = new Date(`${day}T00:00:00Z`);
    run = prev && (d - prev) / 86400000 === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }

  const minutes = Math.round(reading.seconds / 60);
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    registeredAt: user.registered_at,
    lastActiveAt: user.last_active_at,
    researchConsent: !!user.research_consent,
    coinsNow: user.coins,
    activeDays: activeDays.c,
    readingDays: reading.reading_days,
    longestStreak: longest,
    rounds: reading.rounds,
    stoppedEarly: reading.stopped_early,
    readMinutes: minutes,
    minutesPerActiveDay: activeDays.c ? round1(minutes / activeDays.c) : 0,
  };
}

// ---------- คะแนนก่อน/หลังอ่านรายบท ----------
async function buildChapters(userId) {
  const rows = await db
    .prepare(
      `SELECT c.chapter_number n, c.title,
              MAX(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) passed,
              MAX(t.attempt) attempts,
              MAX(t.total) total,
              MAX(t.pre_score) pre_score,
              MAX(COALESCE(t.first_post_score, t.post_score, t.last_post_score)) post_score
       FROM chapter_tests t JOIN chapters c ON c.id = t.chapter_id
       WHERE t.user_id = ?
       GROUP BY c.id ORDER BY c.chapter_number`
    )
    .all(userId);
  return rows.map((r) => {
    const total = r.total || 0;
    const pre = r.pre_score === null ? null : pct(r.pre_score, total);
    const post = r.post_score === null ? null : pct(r.post_score, total);
    return {
      chapter: r.n,
      title: r.title,
      attempts: r.attempts,
      passed: !!r.passed,
      prePercent: pre,
      postPercent: post,
      gain: pre !== null && post !== null ? post - pre : null,
    };
  });
}

// ---------- การทบทวน (รวม + แยกตามระยะที่เว้น 1/3/7/14 วัน) ----------
async function buildReview(userId) {
  const [items, due, byInterval] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) total, COALESCE(SUM(CASE WHEN stage >= ? THEN 1 ELSE 0 END), 0) mastered,
                COALESCE(SUM(CASE WHEN due_at IS NOT NULL AND datetime(due_at) <= datetime('now') THEN 1 ELSE 0 END), 0) due_now
         FROM review_items WHERE user_id = ?`
      )
      .get(MASTERED_STAGE, userId),
    db
      .prepare("SELECT COUNT(*) total, COALESCE(SUM(correct), 0) correct FROM review_log WHERE user_id = ? AND was_due = 1")
      .get(userId),
    db
      .prepare(
        `SELECT stage_before, COUNT(*) total, COALESCE(SUM(correct), 0) correct
         FROM review_log WHERE user_id = ? AND was_due = 1 AND stage_before BETWEEN 1 AND ?
         GROUP BY stage_before ORDER BY stage_before`
      )
      .all(userId, INTERVAL_DAYS.length),
  ]);

  const byStage = new Map(byInterval.map((r) => [r.stage_before, r]));
  return {
    items: items.total,
    mastered: items.mastered,
    masteredPercent: pct(items.mastered, items.total),
    dueNow: items.due_now,
    dueAnswers: due.total,
    dueCorrectPercent: pct(due.correct, due.total),
    intervals: INTERVAL_DAYS.map((days, i) => {
      const row = byStage.get(i + 1);
      return {
        days,
        answers: row ? row.total : 0,
        correctPercent: row ? pct(row.correct, row.total) : 0,
      };
    }),
  };
}

// ---------- รอบการอ่านล่าสุด ----------
async function buildSessions(userId, limit = 10) {
  const rows = await db
    .prepare(
      `SELECT s.id, c.chapter_number chapter, c.title,
              datetime(s.started_at, '${THAI}') started_at,
              s.planned_read_seconds, s.read_seconds, s.pdf_total_pages,
              (SELECT COUNT(*) FROM reading_page_time p WHERE p.session_id = s.id AND p.seconds >= ?) pages_viewed
       FROM reading_sessions s JOIN chapters c ON c.id = s.chapter_id
       WHERE s.user_id = ? AND s.status = 'completed'
       ORDER BY s.started_at DESC LIMIT ?`
    )
    .all(PAGE_VIEWED_MIN_SECONDS, userId, limit);
  return rows.map((r) => ({
    startedAt: r.started_at,
    chapter: r.chapter,
    title: r.title,
    plannedMinutes: Math.round(r.planned_read_seconds / 60),
    readMinutes: Math.round((r.read_seconds || 0) / 60),
    pagesViewed: r.pages_viewed,
    pdfTotalPages: r.pdf_total_pages,
    stoppedEarly: (r.read_seconds || 0) < r.planned_read_seconds,
  }));
}

// ---------- มินิเกมรายโลก ----------
async function buildWorlds(userId) {
  const [chapters, clears, battles] = await Promise.all([
    db.prepare("SELECT chapter_number n, title FROM chapters ORDER BY chapter_number").all(),
    db.prepare("SELECT world, COUNT(*) c FROM game_stage_clears WHERE user_id = ? GROUP BY world").all(userId),
    db
      .prepare(
        `SELECT COUNT(*) plays, COALESCE(SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END), 0) wins
         FROM game_battles WHERE user_id = ?`
      )
      .get(userId),
  ]);
  const clearedBy = new Map(clears.map((c) => [c.world, c.c]));
  return {
    plays: battles.plays,
    wins: battles.wins,
    stagesPerWorld: STAGES_PER_WORLD,
    worlds: chapters.map((c) => ({
      world: c.n,
      title: c.title,
      cleared: clearedBy.get(c.n) || 0,
    })),
  };
}

// ---------- น้องหมา + ถาม AI + ร้านค้า ----------
async function buildExtras(userId) {
  const [pet, care, ai, busiest, shop] = await Promise.all([
    db.prepare("SELECT name, level, happiness, hunger, cleanliness, energy FROM pets WHERE user_id = ?").get(userId),
    db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN is_free = 1 AND action <> 'visit' THEN 1 ELSE 0 END), 0) free,
                COALESCE(SUM(CASE WHEN is_free = 0 THEN 1 ELSE 0 END), 0) item,
                COALESCE(SUM(CASE WHEN action = 'visit' THEN 1 ELSE 0 END), 0) visits
         FROM pet_action_log WHERE user_id = ?`
      )
      .get(userId),
    db.prepare("SELECT COUNT(*) c FROM chat_history WHERE user_id = ?").get(userId),
    db
      .prepare(
        `SELECT c.chapter_number n, c.title, COUNT(*) c FROM chat_history h
         JOIN chapters c ON c.id = h.chapter_id
         WHERE h.user_id = ? GROUP BY c.id ORDER BY c DESC LIMIT 1`
      )
      .get(userId),
    db
      .prepare(
        `SELECT COUNT(*) purchases, COALESCE(SUM(price), 0) spent FROM purchase_log WHERE user_id = ?`
      )
      .get(userId),
  ]);

  return {
    pet: pet
      ? {
          name: pet.name,
          level: pet.level,
          happiness: pet.happiness,
          hunger: pet.hunger,
          cleanliness: pet.cleanliness,
          energy: pet.energy,
          careFree: care.free,
          careItem: care.item,
          visits: care.visits,
        }
      : null,
    ai: {
      questions: ai.c,
      busiestChapter: busiest ? { chapter: busiest.n, title: busiest.title, count: busiest.c } : null,
    },
    shop: { purchases: shop.purchases, coinsSpent: shop.spent },
  };
}


// ---------- ปฏิทินการอ่าน (นาทีที่อ่านต่อวัน ย้อนหลัง 12 สัปดาห์) ----------
async function buildHeatmap(userId, weeks = 12) {
  const days = weeks * 7;
  const rows = await db
    .prepare(
      `SELECT date(started_at, '${THAI}') day, COALESCE(SUM(read_seconds), 0) seconds
       FROM reading_sessions
       WHERE user_id = ? AND status = 'completed'
         AND datetime(started_at, '${THAI}') >= datetime('now', '${THAI}', '-${days - 1} days', 'start of day')
       GROUP BY day`
    )
    .all(userId);
  const byDay = Object.fromEntries(rows.map((r) => [r.day, Math.round(r.seconds / 60)]));

  const out = [];
  const now = new Date(Date.now() + 7 * 3600 * 1000);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    const day = d.toISOString().slice(0, 10);
    out.push({ day, minutes: byDay[day] || 0 });
  }
  return out;
}

// ---------- ความแม่นรายบท (คำตอบจากหลังอ่าน + มินิเกม + ทบทวน) เทียบกับค่าเฉลี่ยของทุกคน ----------
async function buildAccuracy(userId) {
  const [chapters, mine, everyone] = await Promise.all([
    db.prepare("SELECT id, chapter_number n, title FROM chapters ORDER BY chapter_number").all(),
    db
      .prepare(
        `SELECT chapter_id, COUNT(*) total, COALESCE(SUM(correct), 0) correct
         FROM review_log WHERE user_id = ? GROUP BY chapter_id`
      )
      .all(userId),
    db
      .prepare(
        `SELECT l.chapter_id, COUNT(*) total, COALESCE(SUM(l.correct), 0) correct
         FROM review_log l JOIN users u ON u.id = l.user_id AND u.is_admin = 0
         GROUP BY l.chapter_id`
      )
      .all(),
  ]);
  const mineBy = new Map(mine.map((r) => [r.chapter_id, r]));
  const allBy = new Map(everyone.map((r) => [r.chapter_id, r]));
  return chapters.map((c) => {
    const m = mineBy.get(c.id);
    const a = allBy.get(c.id);
    return {
      chapter: c.n,
      title: c.title,
      answers: m ? m.total : 0,
      percent: m ? pct(m.correct, m.total) : null,
      averagePercent: a ? pct(a.correct, a.total) : null,
    };
  });
}

// ---------- ความคืบหน้ารายสัปดาห์ (8 สัปดาห์ล่าสุด) ----------
async function buildWeekly(userId, weeks = 8) {
  const days = weeks * 7;
  const [reading, tests] = await Promise.all([
    db
      .prepare(
        `SELECT date(started_at, '${THAI}', 'weekday 0', '-6 days') week_start,
                COALESCE(SUM(read_seconds), 0) seconds, COUNT(*) rounds
         FROM reading_sessions
         WHERE user_id = ? AND status = 'completed'
           AND datetime(started_at, '${THAI}') >= datetime('now', '${THAI}', '-${days - 1} days', 'start of day')
         GROUP BY week_start`
      )
      .all(userId),
    db
      .prepare(
        `SELECT date(completed_at, '${THAI}', 'weekday 0', '-6 days') week_start,
                COALESCE(AVG(COALESCE(first_post_score, post_score) * 100.0 / NULLIF(total, 0)), 0) post
         FROM chapter_tests
         WHERE user_id = ? AND status = 'completed' AND completed_at IS NOT NULL
           AND datetime(completed_at, '${THAI}') >= datetime('now', '${THAI}', '-${days - 1} days', 'start of day')
         GROUP BY week_start`
      )
      .all(userId),
  ]);
  const readBy = Object.fromEntries(reading.map((r) => [r.week_start, r]));
  const testBy = Object.fromEntries(tests.map((r) => [r.week_start, r]));

  // วันจันทร์ของแต่ละสัปดาห์ ย้อนหลังตามจำนวนที่ขอ
  const out = [];
  const now = new Date(Date.now() + 7 * 3600 * 1000);
  const monday = new Date(now);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(monday);
    d.setUTCDate(d.getUTCDate() - i * 7);
    const key = d.toISOString().slice(0, 10);
    out.push({
      weekStart: key,
      readMinutes: Math.round((readBy[key]?.seconds || 0) / 60),
      rounds: readBy[key]?.rounds || 0,
      postPercent: testBy[key] ? Math.round(testBy[key].post) : null,
    });
  }
  return out;
}

// ---------- ธงเตือน "สิ่งที่ควรดู" ----------
// severity: "red" = ควรทักเลย | "amber" = เฝ้าดู
function buildFlags({ profile, chapters, review, attempts, daysSinceRead }) {
  const flags = [];

  if (daysSinceRead === null) {
    flags.push({ severity: "red", title: "ยังไม่เคยอ่านสักรอบ", detail: `สมัครตั้งแต่ ${profile.registeredAt?.slice(0, 10) || "—"}` });
  } else if (daysSinceRead >= 7) {
    flags.push({
      severity: daysSinceRead >= 14 ? "red" : "amber",
      title: `ไม่ได้อ่าน ${daysSinceRead} วันแล้ว`,
      detail: `อ่านครั้งล่าสุด ${profile.lastReadDate} · เคยอ่านติดกันนานสุด ${profile.longestStreak} วัน`,
    });
  }

  for (const a of attempts.filter((x) => x.post_tries >= 3)) {
    flags.push({
      severity: "red",
      title: `บทที่ ${a.chapter_number} ทำแบบทดสอบหลังอ่านไม่ผ่าน ${a.post_tries} ครั้ง`,
      detail: a.last_post_score !== null ? `คะแนนครั้งล่าสุด ${a.last_post_score} จาก ${a.total} (ผ่านที่ ${Math.ceil(a.total * PASS_RATIO)})` : "ยังทำไม่จบ",
    });
  }

  if (profile.rounds >= 5 && profile.stoppedEarly / profile.rounds >= 0.5) {
    flags.push({
      severity: "amber",
      title: `หยุดก่อนครบเวลา ${profile.stoppedEarly} จาก ${profile.rounds} รอบ`,
      detail: `คิดเป็น ${pct(profile.stoppedEarly, profile.rounds)}% ของรอบที่อ่านจบ`,
    });
  }

  if (review.dueNow >= 20) {
    flags.push({
      severity: "amber",
      title: `ค้างรอบทบทวน ${review.dueNow} ข้อ`,
      detail: "ถึงกำหนดทบทวนแล้วแต่ยังไม่ได้เข้ามินิเกมมาตอบ",
    });
  }

  for (const c of chapters.filter((x) => x.gain !== null && x.gain < 0)) {
    flags.push({
      severity: "amber",
      title: `บทที่ ${c.chapter} คะแนนหลังอ่านต่ำกว่าก่อนอ่าน`,
      detail: `ก่อนอ่าน ${c.prePercent}% → หลังอ่าน ${c.postPercent}%`,
    });
  }

  if (profile.avgPostPercent !== null && profile.avgPostPercent < 50) {
    flags.push({
      severity: "red",
      title: `คะแนนหลังอ่านเฉลี่ยต่ำ (${profile.avgPostPercent}%)`,
      detail: `เกณฑ์ผ่านอยู่ที่ ${profile.passScorePercent}%`,
    });
  }

  return flags.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "red" ? -1 : 1));
}

async function buildUserReport(userId) {
  const profile = await buildProfile(userId);
  if (!profile) return null;
  const [chapters, review, sessions, game, extras, heatmap, accuracy, weekly, attempts, lastRead] = await Promise.all([
    buildChapters(userId),
    buildReview(userId),
    buildSessions(userId),
    buildWorlds(userId),
    buildExtras(userId),
    buildHeatmap(userId),
    buildAccuracy(userId),
    buildWeekly(userId),
    db
      .prepare(
        `SELECT c.chapter_number, t.post_tries, t.total, t.last_post_score
         FROM chapter_tests t JOIN chapters c ON c.id = t.chapter_id
         WHERE t.user_id = ? AND t.post_tries >= 3 ORDER BY c.chapter_number`
      )
      .all(userId),
    db
      .prepare(
        `SELECT date(MAX(started_at), '${THAI}') day,
                CAST(julianday('now') - julianday(MAX(started_at)) AS INTEGER) days_ago
         FROM reading_sessions WHERE user_id = ? AND status = 'completed'`
      )
      .get(userId),
  ]);
  const scored = chapters.filter((c) => c.postPercent !== null);
  const fullProfile = {
    ...profile,
    chaptersPassed: chapters.filter((c) => c.passed).length,
    chaptersTotal: game.worlds.length,
    avgPostPercent: scored.length ? Math.round(scored.reduce((a, c) => a + c.postPercent, 0) / scored.length) : null,
    passScorePercent: Math.round(PASS_RATIO * 100),
    lastReadDate: lastRead?.day || null,
    daysSinceRead: lastRead?.day ? lastRead.days_ago : null,
  };

  return {
    profile: fullProfile,
    flags: buildFlags({
      profile: fullProfile,
      chapters,
      review,
      attempts,
      daysSinceRead: fullProfile.daysSinceRead,
    }),
    chapters,
    accuracy,
    review,
    sessions,
    heatmap,
    weekly,
    game,
    ...extras,
  };
}

module.exports = { buildUserReport };
