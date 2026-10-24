// ================== ตัวเลขทั้งหมดของหน้าแอดมิน (หน้าหลัก) ==================
// รวมทุกส่วนไว้ในคำขอเดียว: การ์ดสรุปด้านบน, แนวโน้มการใช้งาน, สัดส่วนการอ่านรายบท, น้องหมา,
// อันดับผู้ใช้, เวลาอ่านรายวัน, การทบทวน, ผลลัพธ์การเรียนรู้, การใช้ AI และมินิเกม
// วันที่ทุกที่คิดเป็นเวลาไทย (+7 ชั่วโมง) เหมือนไฟล์ข้อมูลวิจัย
const db = require("../db/database");
const { MASTERED_STAGE } = require("./spacedReview");

const STAGES_PER_WORLD = 5; // ต้องตรงกับ GAME_STAGES_PER_WORLD ใน routes/game.js
const THAI = "+7 hours";

const RANGES = [7, 30, 90, 365]; // วัน (365 = ทั้งปี ใช้แทน "ทั้งหมด")

const pct = (part, total) => (total > 0 ? Math.round((part / total) * 100) : 0);
const round1 = (n) => Math.round(n * 10) / 10;

// รายการวันที่ย้อนหลัง n วัน (เวลาไทย) เรียงจากเก่าไปใหม่ — ใช้เติมวันที่ไม่มีข้อมูลให้กราฟไม่ขาดช่วง
function lastDays(n) {
  const days = [];
  const now = new Date(Date.now() + 7 * 3600 * 1000);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

// นับต่อวันจากตารางใดก็ได้ที่มีคอลัมน์เวลา แล้ว map เป็น { วันที่: จำนวน }
async function countByDay(sql, args = []) {
  const rows = await db.prepare(sql).all(...args);
  return Object.fromEntries(rows.map((r) => [r.day, Number(r.c) || 0]));
}

// ---------- การ์ดสรุปด้านบน ----------
async function buildTiles() {
  const [users, usersLastMonth, chapters, battles, coinsNow, coinsThisMonth, coinsLastMonth, coupons] =
    await Promise.all([
      db.prepare("SELECT COUNT(*) c FROM users WHERE is_admin = 0").get(),
      db
        .prepare(
          `SELECT COUNT(*) c FROM users
           WHERE is_admin = 0 AND datetime(created_at, '${THAI}') < datetime('now', '${THAI}', 'start of month')`
        )
        .get(),
      db.prepare("SELECT COUNT(*) c, COALESCE(SUM(game_enabled), 0) g FROM chapters").get(),
      db.prepare("SELECT COUNT(*) c FROM game_battles").get(),
      db.prepare("SELECT COALESCE(SUM(coins), 0) s FROM users WHERE is_admin = 0").get(),
      db
        .prepare(
          `SELECT COALESCE(SUM(coins_earned), 0) s FROM reading_sessions
           WHERE datetime(started_at, '${THAI}') >= datetime('now', '${THAI}', 'start of month')`
        )
        .get(),
      db
        .prepare(
          `SELECT COALESCE(SUM(coins_earned), 0) s FROM reading_sessions
           WHERE datetime(started_at, '${THAI}') >= datetime('now', '${THAI}', 'start of month', '-1 month')
             AND datetime(started_at, '${THAI}') < datetime('now', '${THAI}', 'start of month')`
        )
        .get(),
      db.prepare("SELECT COUNT(*) c, COALESCE(SUM(discount_baht), 0) baht FROM user_coupons").get(),
    ]);

  const newUsers = users.c - usersLastMonth.c;
  const worlds = chapters.g;
  return {
    users: {
      total: users.c,
      changePercent: usersLastMonth.c > 0 ? Math.round((newUsers / usersLastMonth.c) * 100) : null,
      newSinceLastMonth: newUsers,
    },
    chapters: { total: chapters.c, withGame: worlds },
    game: { worlds, stages: worlds * STAGES_PER_WORLD, battles: battles.c },
    coins: {
      inCirculation: coinsNow.s,
      thisMonth: coinsThisMonth.s,
      changePercent: coinsLastMonth.s > 0 ? Math.round(((coinsThisMonth.s - coinsLastMonth.s) / coinsLastMonth.s) * 100) : null,
    },
    coupons: { issued: coupons.c, baht: coupons.baht },
  };
}

// ---------- แนวโน้มการใช้งาน (ผู้ใช้ที่ใช้งาน / การอ่าน / มินิเกม / ถาม AI) ----------
async function buildTrend(days) {
  const since = `datetime('now', '${THAI}', '-${days - 1} days', 'start of day')`;
  const dayExpr = (col) => `date(${col}, '${THAI}')`;
  const [reading, battles, ai, active] = await Promise.all([
    countByDay(
      `SELECT ${dayExpr("started_at")} day, COUNT(*) c FROM reading_sessions
       WHERE status = 'completed' AND datetime(started_at, '${THAI}') >= ${since} GROUP BY day`
    ),
    countByDay(
      `SELECT ${dayExpr("started_at")} day, COUNT(*) c FROM game_battles
       WHERE datetime(started_at, '${THAI}') >= ${since} GROUP BY day`
    ),
    countByDay(
      `SELECT ${dayExpr("created_at")} day, COUNT(*) c FROM chat_history
       WHERE datetime(created_at, '${THAI}') >= ${since} GROUP BY day`
    ),
    countByDay(
      `SELECT day, COUNT(DISTINCT user_id) c FROM (
         SELECT user_id, ${dayExpr("started_at")} day FROM reading_sessions WHERE datetime(started_at, '${THAI}') >= ${since}
         UNION ALL
         SELECT user_id, ${dayExpr("started_at")} day FROM game_battles WHERE datetime(started_at, '${THAI}') >= ${since}
         UNION ALL
         SELECT user_id, ${dayExpr("created_at")} day FROM chat_history WHERE datetime(created_at, '${THAI}') >= ${since}
         UNION ALL
         SELECT user_id, ${dayExpr("created_at")} day FROM pet_action_log WHERE datetime(created_at, '${THAI}') >= ${since}
       ) GROUP BY day`
    ),
  ]);

  return lastDays(days).map((day) => ({
    day,
    activeUsers: active[day] || 0,
    readings: reading[day] || 0,
    battles: battles[day] || 0,
    aiQuestions: ai[day] || 0,
  }));
}

// ---------- สัดส่วนการอ่านรายบท (รอบอ่านที่อ่านจบในช่วงที่เลือก) ----------
async function buildChapterShare(days) {
  const rows = await db
    .prepare(
      `SELECT c.chapter_number n, c.title, COUNT(*) c FROM reading_sessions s
       JOIN chapters c ON c.id = s.chapter_id
       WHERE s.status = 'completed' AND datetime(s.started_at, '${THAI}') >= datetime('now', '${THAI}', '-${days - 1} days', 'start of day')
       GROUP BY c.id ORDER BY c DESC`
    )
    .all();
  const total = rows.reduce((a, r) => a + r.c, 0);
  return {
    total,
    items: rows.map((r) => ({
      chapter: r.n,
      title: r.title,
      sessions: r.c,
      percent: pct(r.c, total),
    })),
  };
}

// ---------- ภาพรวมน้องหมาของผู้ใช้ทุกคน ----------
async function buildPet(days) {
  const since = `datetime('now', '${THAI}', '-${days - 1} days', 'start of day')`;
  const [stats, actions, levels] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) pets, COALESCE(AVG(happiness), 0) happiness, COALESCE(AVG(hunger), 0) hunger,
                COALESCE(AVG(cleanliness), 0) cleanliness, COALESCE(AVG(energy), 0) energy
         FROM pets`
      )
      .get(),
    db
      .prepare(
        `SELECT action, COUNT(*) c FROM pet_action_log
         WHERE datetime(created_at, '${THAI}') >= ${since} GROUP BY action ORDER BY c DESC`
      )
      .all(),
    db.prepare("SELECT COALESCE(AVG(level), 0) lv, COALESCE(MAX(level), 0) best FROM pets").get(),
  ]);
  return {
    pets: stats.pets,
    happiness: Math.round(stats.happiness),
    hunger: Math.round(stats.hunger),
    cleanliness: Math.round(stats.cleanliness),
    energy: Math.round(stats.energy),
    avgLevel: round1(levels.lv),
    topLevel: levels.best,
    actions: actions.map((a) => ({ action: a.action, count: a.c })),
  };
}

// ---------- อันดับผู้ใช้ที่อ่านมากที่สุด ----------
async function buildTopReaders() {
  const rows = await db
    .prepare(
      `SELECT u.id, u.username, u.coins,
              COALESCE(SUM(s.read_seconds), 0) seconds,
              COUNT(s.id) sessions
       FROM users u
       LEFT JOIN reading_sessions s ON s.user_id = u.id AND s.status = 'completed'
       WHERE u.is_admin = 0
       GROUP BY u.id
       HAVING sessions > 0
       ORDER BY seconds DESC
       LIMIT 10`
    )
    .all();
  const scores = await db
    .prepare(
      `SELECT user_id, COALESCE(AVG(pre_score * 100.0 / NULLIF(total, 0)), 0) pre,
              COALESCE(AVG(COALESCE(first_post_score, post_score, last_post_score) * 100.0 / NULLIF(total, 0)), 0) post
       FROM chapter_tests WHERE status = 'completed' GROUP BY user_id`
    )
    .all();
  const byUser = new Map(scores.map((s) => [s.user_id, s]));
  return rows.map((r, i) => {
    const s = byUser.get(r.id);
    return {
      rank: i + 1,
      id: r.id,
      username: r.username,
      readMinutes: Math.round(r.seconds / 60),
      sessions: r.sessions,
      prePercent: s ? Math.round(s.pre) : null,
      postPercent: s ? Math.round(s.post) : null,
      coins: r.coins,
    };
  });
}

// ---------- เวลาอ่านและจำนวนรอบรายวัน ----------
async function buildReadingByDay(days) {
  const rows = await db
    .prepare(
      `SELECT date(started_at, '${THAI}') day, COALESCE(SUM(read_seconds), 0) seconds, COUNT(*) c
       FROM reading_sessions
       WHERE status = 'completed' AND datetime(started_at, '${THAI}') >= datetime('now', '${THAI}', '-${days - 1} days', 'start of day')
       GROUP BY day`
    )
    .all();
  const byDay = Object.fromEntries(rows.map((r) => [r.day, r]));
  return lastDays(days).map((day) => ({
    day,
    hours: round1((byDay[day]?.seconds || 0) / 3600),
    sessions: byDay[day]?.c || 0,
  }));
}

// ---------- การทบทวน (ตามรอบ 1/3/7/14 วัน) ----------
async function buildReview() {
  const [items, due, topics] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) total, COALESCE(SUM(CASE WHEN stage >= ? THEN 1 ELSE 0 END), 0) mastered,
                COALESCE(SUM(CASE WHEN due_at IS NOT NULL AND datetime(due_at) <= datetime('now') THEN 1 ELSE 0 END), 0) due_now
         FROM review_items`
      )
      .get(MASTERED_STAGE),
    db
      .prepare(
        `SELECT COUNT(*) total, COALESCE(SUM(correct), 0) correct FROM review_log WHERE was_due = 1`
      )
      .get(),
    db
      .prepare(
        `SELECT c.title, COUNT(*) c, COALESCE(SUM(l.correct), 0) correct
         FROM review_log l JOIN chapters c ON c.id = l.chapter_id
         GROUP BY c.id ORDER BY c DESC LIMIT 5`
      )
      .all(),
  ]);
  return {
    items: items.total,
    mastered: items.mastered,
    masteredPercent: pct(items.mastered, items.total),
    dueNow: items.due_now,
    dueAnswers: due.total,
    dueCorrectPercent: pct(due.correct, due.total),
    topics: topics.map((t) => ({ title: t.title, count: t.c, correctPercent: pct(t.correct, t.c) })),
  };
}

// ---------- ผลลัพธ์การเรียนรู้รายบท (ก่อนอ่าน → หลังอ่าน) ----------
async function buildLearning() {
  const rows = await db
    .prepare(
      `SELECT c.chapter_number n, c.title,
              COUNT(*) tests,
              COALESCE(AVG(t.pre_score * 100.0 / NULLIF(t.total, 0)), 0) pre,
              COALESCE(AVG(COALESCE(t.first_post_score, t.post_score, t.last_post_score) * 100.0 / NULLIF(t.total, 0)), 0) post
       FROM chapter_tests t JOIN chapters c ON c.id = t.chapter_id
       WHERE t.status = 'completed'
       GROUP BY c.id ORDER BY c.chapter_number`
    )
    .all();
  return rows.map((r) => ({
    chapter: r.n,
    title: r.title,
    tests: r.tests,
    pre: Math.round(r.pre),
    post: Math.round(r.post),
    gain: Math.round(r.post - r.pre),
  }));
}

// ---------- การใช้ AI ----------
async function buildAi(days) {
  const since = `datetime('now', '${THAI}', '-${days - 1} days', 'start of day')`;
  const [totals, top, byChapter] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) c, COUNT(DISTINCT user_id) users FROM chat_history
         WHERE datetime(created_at, '${THAI}') >= ${since}`
      )
      .get(),
    db
      .prepare(
        `SELECT trim(question) q, COUNT(*) c FROM chat_history
         WHERE datetime(created_at, '${THAI}') >= ${since}
         GROUP BY lower(trim(question)) ORDER BY c DESC LIMIT 5`
      )
      .all(),
    db
      .prepare(
        `SELECT c.chapter_number n, c.title, COUNT(*) c FROM chat_history h
         JOIN chapters c ON c.id = h.chapter_id
         WHERE datetime(h.created_at, '${THAI}') >= ${since}
         GROUP BY c.id ORDER BY c DESC LIMIT 1`
      )
      .get(),
  ]);
  return {
    questions: totals.c,
    users: totals.users,
    top: top.map((t) => ({ question: t.q, count: t.c })),
    busiestChapter: byChapter ? { chapter: byChapter.n, title: byChapter.title, count: byChapter.c } : null,
  };
}

// ---------- มินิเกมรายโลก (โลกที่ n = บทที่ n) ----------
async function buildGames() {
  const rows = await db
    .prepare(
      `SELECT b.world, c.title,
              COUNT(*) plays,
              COALESCE(SUM(CASE WHEN b.status = 'won' THEN 1 ELSE 0 END), 0) wins
       FROM game_battles b LEFT JOIN chapters c ON c.chapter_number = b.world
       GROUP BY b.world ORDER BY b.world`
    )
    .all();
  return rows.map((r) => ({
    world: r.world,
    title: r.title || `บทที่ ${r.world}`,
    plays: r.plays,
    wins: r.wins,
    percent: pct(r.wins, r.plays),
  }));
}

// ---------- พฤติกรรมล่าสุดของน้องหมา (ล่าสุดของแต่ละแบบ) ----------
async function buildPetRecent() {
  const rows = await db
    .prepare(
      `SELECT action, MAX(created_at) at,
              CAST((julianday('now') - julianday(MAX(created_at))) * 24 * 60 AS INTEGER) minutes_ago
       FROM pet_action_log
       WHERE action <> 'visit'
       GROUP BY action
       ORDER BY at DESC
       LIMIT 5`
    )
    .all();
  return rows.map((r) => ({ action: r.action, minutesAgo: Math.max(0, r.minutes_ago) }));
}

// ---------- ตอบถูกตอนถึงรอบทบทวน: เดือนนี้เทียบเดือนที่แล้ว ----------
async function buildReviewTrend() {
  const monthSql = (from, to) =>
    `SELECT COUNT(*) total, COALESCE(SUM(correct), 0) correct FROM review_log
     WHERE was_due = 1 AND datetime(created_at, '${THAI}') >= ${from}
       ${to ? `AND datetime(created_at, '${THAI}') < ${to}` : ""}`;
  const [thisMonth, lastMonth] = await Promise.all([
    db.prepare(monthSql(`datetime('now', '${THAI}', 'start of month')`, null)).get(),
    db
      .prepare(
        monthSql(
          `datetime('now', '${THAI}', 'start of month', '-1 month')`,
          `datetime('now', '${THAI}', 'start of month')`
        )
      )
      .get(),
  ]);
  const now = pct(thisMonth.correct, thisMonth.total);
  const before = pct(lastMonth.correct, lastMonth.total);
  return {
    thisMonthPercent: now,
    lastMonthPercent: before,
    changePoints: lastMonth.total > 0 ? now - before : null, // null = เดือนที่แล้วยังไม่มีข้อมูลให้เทียบ
    answers: thisMonth.total,
  };
}

// ---------- คำแนะนำจากข้อมูล (แสดงในการ์ดการใช้ AI) ----------
async function buildAdvice(days) {
  const since = `datetime('now', '${THAI}', '-${days - 1} days', 'start of day')`;
  const [weakTopic, busyHour] = await Promise.all([
    db
      .prepare(
        `SELECT c.chapter_number n, c.title, COUNT(*) c, COALESCE(SUM(l.correct), 0) correct
         FROM review_log l JOIN chapters c ON c.id = l.chapter_id
         GROUP BY c.id HAVING c >= 5
         ORDER BY (correct * 1.0 / c) ASC LIMIT 1`
      )
      .get(),
    db
      .prepare(
        `SELECT strftime('%H', datetime(created_at, '${THAI}')) hour, COUNT(*) c FROM chat_history
         WHERE datetime(created_at, '${THAI}') >= ${since}
         GROUP BY hour ORDER BY c DESC LIMIT 1`
      )
      .get(),
  ]);
  return {
    weakTopic: weakTopic
      ? { chapter: weakTopic.n, title: weakTopic.title, correctPercent: pct(weakTopic.correct, weakTopic.c), answers: weakTopic.c }
      : null,
    busyHour: busyHour ? { hour: Number(busyHour.hour), count: busyHour.c } : null,
  };
}

// ---------- กระดิ่ง: สิ่งที่แอดมินแก้ล่าสุด ----------
async function buildAdminUpdates() {
  const [coins, answers, meta] = await Promise.all([
    db
      .prepare(
        `SELECT a.created_at at, a.amount, a.reason, u.username
         FROM coin_adjustments a LEFT JOIN users u ON u.id = a.user_id
         ORDER BY a.created_at DESC LIMIT 5`
      )
      .all(),
    db.prepare("SELECT updated_at at, keywords FROM chat_answers ORDER BY updated_at DESC LIMIT 5").all(),
    db.prepare("SELECT key, value FROM site_meta WHERE key IN ('latest_update_at', 'latest_update_message')").all(),
  ]);
  const metaBy = Object.fromEntries(meta.map((m) => [m.key, m.value]));

  const items = [
    ...coins.map((c) => ({
      at: c.at,
      kind: "coins",
      text: `ปรับคอยน์ให้ ${c.username || "ผู้ใช้ที่ถูกลบ"} ${c.amount > 0 ? "+" : ""}${c.amount} (${c.reason})`,
    })),
    ...answers.map((a) => ({ at: a.at, kind: "chat", text: `แก้คำตอบแชทบอท: ${a.keywords}` })),
  ];
  if (metaBy.latest_update_at) {
    items.push({ at: metaBy.latest_update_at, kind: "announce", text: metaBy.latest_update_message || "ประกาศอัปเดตเว็บ" });
  }

  return items
    .filter((i) => i.at)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, 6)
    .map((i) => ({
      ...i,
      minutesAgo: Math.max(0, Math.round((Date.now() - Date.parse(`${String(i.at).replace(" ", "T")}Z`)) / 60000)),
    }));
}

// ---------- นิสิตที่ควรดูแล (การ์ดบนหน้าหลัก) ----------
// ติดธงเมื่อเข้าเกณฑ์อย่างน้อย 1 ข้อ — เกณฑ์เดียวกับธงเตือนในหน้ารายละเอียดรายคน
const AT_RISK = {
  lowPostPercent: 50, // คะแนนหลังอ่านเฉลี่ยต่ำกว่านี้
  failTries: 3, // ทำ post ไม่ผ่านกี่ครั้งในบทเดียว
  quietDays: 7, // ไม่ได้อ่านกี่วัน
  stoppedRatio: 0.5, // หยุดก่อนครบเวลาเกินครึ่งของรอบที่อ่าน (ต้องมีอย่างน้อย 5 รอบ)
  minRounds: 5,
  dueItems: 20, // ค้างรอบทบทวนกี่ข้อ
};

async function buildAtRisk() {
  const [users, scores, reading, fails, due] = await Promise.all([
    db.prepare("SELECT id, username FROM users WHERE is_admin = 0").all(),
    db
      .prepare(
        `SELECT user_id, COALESCE(AVG(COALESCE(first_post_score, post_score, last_post_score) * 100.0 / NULLIF(total, 0)), 0) post,
                COUNT(*) tests
         FROM chapter_tests WHERE status = 'completed' GROUP BY user_id`
      )
      .all(),
    db
      .prepare(
        `SELECT user_id, COUNT(*) rounds,
                COALESCE(SUM(CASE WHEN read_seconds < planned_read_seconds THEN 1 ELSE 0 END), 0) stopped_early,
                date(MAX(started_at), '${THAI}') last_day,
                CAST(julianday('now') - julianday(MAX(started_at)) AS INTEGER) days_ago
         FROM reading_sessions WHERE status = 'completed' GROUP BY user_id`
      )
      .all(),
    db
      .prepare(
        `SELECT t.user_id, c.chapter_number, MAX(t.post_tries) tries
         FROM chapter_tests t JOIN chapters c ON c.id = t.chapter_id
         WHERE t.post_tries >= ? GROUP BY t.user_id, c.id`
      )
      .all(AT_RISK.failTries),
    db
      .prepare(
        `SELECT user_id, COUNT(*) c FROM review_items
         WHERE due_at IS NOT NULL AND datetime(due_at) <= datetime('now') GROUP BY user_id`
      )
      .all(),
  ]);

  const scoreBy = new Map(scores.map((r) => [r.user_id, r]));
  const readBy = new Map(reading.map((r) => [r.user_id, r]));
  const dueBy = new Map(due.map((r) => [r.user_id, r.c]));
  const failBy = new Map();
  for (const f of fails) {
    if (!failBy.has(f.user_id)) failBy.set(f.user_id, []);
    failBy.get(f.user_id).push(f);
  }

  const rows = [];
  for (const u of users) {
    const score = scoreBy.get(u.id);
    const read = readBy.get(u.id);
    const dueNow = dueBy.get(u.id) || 0;
    const tags = [];

    const postPercent = score && score.tests ? Math.round(score.post) : null;
    if (postPercent !== null && postPercent < AT_RISK.lowPostPercent) {
      tags.push({ severity: "red", text: `หลังอ่านเฉลี่ย ${postPercent}%` });
    }
    for (const f of failBy.get(u.id) || []) {
      tags.push({ severity: "red", text: `ไม่ผ่านบทที่ ${f.chapter_number} · ${f.tries} ครั้ง` });
    }
    if (!read) {
      tags.push({ severity: "red", text: "ยังไม่เคยอ่านสักรอบ" });
    } else if (read.days_ago >= AT_RISK.quietDays) {
      tags.push({
        severity: read.days_ago >= AT_RISK.quietDays * 2 ? "red" : "amber",
        text: `ไม่ได้อ่าน ${read.days_ago} วัน`,
      });
    }
    if (read && read.rounds >= AT_RISK.minRounds && read.stopped_early / read.rounds >= AT_RISK.stoppedRatio) {
      tags.push({ severity: "amber", text: `หยุดก่อนครบ ${read.stopped_early}/${read.rounds} รอบ` });
    }
    if (dueNow >= AT_RISK.dueItems) {
      tags.push({ severity: "amber", text: `ค้างรอบทบทวน ${dueNow} ข้อ` });
    }
    if (!tags.length) continue;

    rows.push({
      id: u.id,
      username: u.username,
      postPercent,
      lastReadDate: read ? read.last_day : null,
      daysSinceRead: read ? read.days_ago : null,
      tags,
      reds: tags.filter((t) => t.severity === "red").length,
    });
  }

  rows.sort((a, b) => b.reds - a.reds || b.tags.length - a.tags.length || (a.postPercent ?? 100) - (b.postPercent ?? 100));
  return { total: users.length, criteria: AT_RISK, users: rows.slice(0, 8) };
}

// days = ช่วงเวลาของส่วนที่ดูเป็นช่วง (แนวโน้ม, สัดส่วนรายบท, น้องหมา, การใช้ AI)
async function buildDashboard(days = 7) {
  const range = RANGES.includes(Number(days)) ? Number(days) : 7;
  const [tiles, trend, chapterShare, pet, petRecent, topReaders, readingByDay, review, reviewTrend, learning, ai, advice, updates, games, atRisk] = await Promise.all([
    buildTiles(),
    buildTrend(range),
    buildChapterShare(range),
    buildPet(range),
    buildPetRecent(),
    buildTopReaders(),
    buildReadingByDay(7),
    buildReview(),
    buildReviewTrend(),
    buildLearning(),
    buildAi(range),
    buildAdvice(range),
    buildAdminUpdates(),
    buildGames(),
    buildAtRisk(),
  ]);
  return {
    range,
    ranges: RANGES,
    tiles,
    trend,
    chapterShare,
    pet: { ...pet, recent: petRecent },
    topReaders,
    readingByDay,
    review: { ...review, trend: reviewTrend },
    learning,
    ai: { ...ai, advice },
    updates,
    games,
    atRisk,
  };
}

module.exports = { buildDashboard };
