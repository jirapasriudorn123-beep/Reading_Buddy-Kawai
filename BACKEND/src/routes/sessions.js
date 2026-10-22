const express = require("express");
const db = require("../db/database");
const { requireAuth } = require("../middleware/auth");
const { NORMAL_RULES, getReadingRules, dailyTimeCoinCap, coinsPerRound, timeCoinsToday } = require("../services/readingRules");
const tests = require("../services/chapterTests");
const { boostHappinessForReading, getReadingStreak } = require("../services/petCare");

const router = express.Router();

// คอยน์ต่อก้อนคงที่ (10) ส่วนกี่นาทีได้ 1 ก้อน ล็อกไว้ในเซสชันตั้งแต่เริ่ม (minutes_per_block: 5 ปกติ, 1 โหมดสาธิต)
const COINS_PER_BLOCK = NORMAL_RULES.coinsPerBlock;
const AWAY_GRACE_SECONDS = 15;

// จำนวนวินาทีตั้งแต่เวลา datetime('now') ของ SQLite (UTC, ไม่มี timezone ต่อท้าย) จนถึงตอนนี้
function secondsSince(sqliteDatetime) {
  return Math.max(0, Math.floor((Date.now() - new Date(sqliteDatetime + "Z").getTime()) / 1000));
}

// ================== เวลาที่เปิดแต่ละหน้าของ PDF (หลักฐานเสริม ไม่มีผลกับคอยน์) ==================
const PAGE_VIEWED_MIN_SECONDS = 5; // เปิดหน้านั้นอย่างน้อยเท่านี้ ถึงนับว่า "เปิดอ่าน" (เลื่อนผ่านเร็วๆ ไม่นับ)
const MAX_PDF_PAGES = 2000;

// สรุปหน้าที่เปิดอ่านของรอบนี้ (โชว์ตอนจบรอบ + ใช้ในไฟล์ส่งออก)
async function pageSummary(sessionId) {
  const rows = await db
    .prepare("SELECT page, seconds FROM reading_page_time WHERE session_id = ? ORDER BY page ASC")
    .all(sessionId);
  const viewed = rows.filter((r) => r.seconds >= PAGE_VIEWED_MIN_SECONDS);
  const session = await db.prepare("SELECT pdf_total_pages FROM reading_sessions WHERE id = ?").get(sessionId);
  return {
    totalPages: session ? session.pdf_total_pages : null,
    pagesViewed: viewed.length,
    firstPage: viewed.length ? viewed[0].page : null,
    lastPage: viewed.length ? viewed[viewed.length - 1].page : null,
    trackedSeconds: rows.reduce((a, r) => a + r.seconds, 0),
  };
}

// ---------- POST /api/sessions/:sessionId/pages ----------
// หน้าเว็บส่งเวลาสะสมของแต่ละหน้าในรอบนี้มาเป็นระยะ — body: { totalPages, currentPage, pages: { "1": 30, "2": 45 } }
// เก็บค่าที่มากที่สุดของแต่ละหน้า (ส่งซ้ำ/ส่งยอดเดิมไม่นับซ้ำ) และแต่ละหน้าไม่เกินเวลาที่ผ่านไปจริงตั้งแต่เริ่มรอบ
router.post("/:sessionId/pages", requireAuth, async (req, res, next) => {
  try {
    const sessionId = Number(req.params.sessionId);
    const session = await db
      .prepare("SELECT user_id, status, started_at FROM reading_sessions WHERE id = ?")
      .get(sessionId);
    if (!session || session.user_id !== req.user.id) {
      return res.status(404).json({ message: "ไม่พบเซสชันการอ่านนี้" });
    }
    if (session.status !== "in_progress") return res.json({ ok: false });

    const totalPages = Number(req.body.totalPages);
    const currentPage = Number(req.body.currentPage);
    const pages = req.body.pages && typeof req.body.pages === "object" ? req.body.pages : {};
    if (!Number.isInteger(totalPages) || totalPages < 1 || totalPages > MAX_PDF_PAGES) {
      return res.status(400).json({ message: "จำนวนหน้าไม่ถูกต้อง" });
    }
    const maxSeconds = secondsSince(session.started_at) + 5;
    const entries = Object.entries(pages)
      .map(([page, seconds]) => [Number(page), Math.floor(Number(seconds))])
      .filter(([page, seconds]) => Number.isInteger(page) && page >= 1 && page <= totalPages && seconds > 0)
      .map(([page, seconds]) => [page, Math.min(seconds, maxSeconds)]);

    await db.tx(async (t) => {
      for (const [page, seconds] of entries) {
        await t.prepare(
          `INSERT INTO reading_page_time (session_id, page, seconds) VALUES (?, ?, ?)
           ON CONFLICT(session_id, page) DO UPDATE SET seconds = MAX(seconds, excluded.seconds)`
        ).run(sessionId, page, seconds);
      }
      await t.prepare("UPDATE reading_sessions SET pdf_total_pages = ?, last_page = ? WHERE id = ?").run(
        totalPages,
        Number.isInteger(currentPage) && currentPage >= 1 && currentPage <= totalPages ? currentPage : null,
        sessionId
      );
    });
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------- POST /api/sessions/:sessionId/complete ----------
// จบรอบอ่าน (อ่านครบเวลาหรือกด "หยุด") — คิดเวลาที่อ่านจริงและคอยน์ของรอบนี้
// คอยน์ยังไม่เข้า: ค้างไว้จนกว่าจะทำแบบทดสอบหลังอ่านของบทนี้ (ไม่ทำ post = ไม่ได้คอยน์)
// คอยน์จากเวลาอ่านได้วันละไม่เกิน 4 รอบ (รอบละ 25 นาที) — อ่านเกินได้ นับเวลาอ่านให้ แต่รอบนั้นไม่ได้คอยน์
router.post("/:sessionId/complete", requireAuth, async (req, res) => {
  try {
    const sessionId = Number(req.params.sessionId);

    const session = await db
      .prepare(
        `SELECT rs.id, rs.user_id, rs.chapter_id, rs.planned_read_seconds, rs.status, rs.started_at,
                rs.away_seconds, rs.away_started_at, rs.minutes_per_block, rs.chapter_test_id, c.title AS chapter_title
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
    // บทที่ได้คอยน์ครบ 4 ครั้งแล้ว: อ่านทบทวนได้ นับเวลาให้ แต่ไม่ได้คอยน์ (และไม่กินโควต้าคอยน์รายวัน)
    const chapterRewardLimitReached =
      !!session.chapter_test_id &&
      (await tests.coinRewardsUsed(req.user.id, session.chapter_id)) >= tests.MAX_COIN_REWARDS_PER_CHAPTER;
    const coinsFromTime = chapterRewardLimitReached
      ? 0
      : Math.floor(effectiveElapsedMinutes / minutesPerBlock) * COINS_PER_BLOCK;
    const completedFullDuration = effectiveElapsedSeconds >= session.planned_read_seconds;

    // ---- โควต้าคอยน์จากเวลาอ่านต่อวัน ----
    const rules = await getReadingRules();
    const cap = dailyTimeCoinCap(rules);
    const usedToday = cap === null ? 0 : await timeCoinsToday(req.user.id);
    const coinsEarned = cap === null ? coinsFromTime : Math.max(0, Math.min(coinsFromTime, cap - usedToday));
    const capped = coinsEarned < coinsFromTime;
    // รอบเก่าที่ไม่ได้ผูกกับแบบทดสอบรายบท (เริ่มก่อนอัปเดตระบบ) ให้คอยน์ทันทีแบบเดิม
    const pending = session.chapter_test_id ? 1 : 0;

    // atomic guard: ปิดเซสชันได้เฉพาะถ้ายัง in_progress อยู่จริงตอน UPDATE
    // (กันกดจบซ้ำพร้อมกัน เช่น ดับเบิลคลิก/เปิดหลายแท็บ แล้วได้เหรียญซ้ำ)
    const closed = await db.tx(async (t) => {
      const result = await t.prepare(
        `UPDATE reading_sessions
         SET status = 'completed', ended_at = datetime('now'), coins_earned = ?, read_seconds = ?, coins_pending = ?
         WHERE id = ? AND status = 'in_progress'`
      ).run(coinsEarned, effectiveElapsedSeconds, pending, sessionId);
      if (result.changes === 0) return false;
      if (!pending) {
        await t.prepare("UPDATE users SET coins = coins + ? WHERE id = ?").run(coinsEarned, req.user.id);
      }
      return true;
    });
    if (!closed) {
      return res.status(400).json({ message: "เซสชันนี้จบไปแล้ว หรือถูกยกเลิกไปแล้ว" });
    }

    // อ่านจบรอบ (ถึงเกณฑ์วันอ่าน) → น้องหมาดีใจ + นับ streak วันนี้
    const petHappinessGained = await boostHappinessForReading(req.user.id, effectiveElapsedSeconds).catch((err) => {
      console.error("Boost pet happiness error:", err);
      return 0;
    });
    const [user, progress, streak] = await Promise.all([
      db.prepare("SELECT coins FROM users WHERE id = ?").get(req.user.id),
      tests.chapterProgress(req.user.id, session.chapter_id),
      getReadingStreak(req.user.id),
    ]);
    const roundsUsed = cap === null ? null : Math.min(rules.dailyCoinRounds, Math.floor((usedToday + coinsEarned) / coinsPerRound(rules)));

    return res.json({
      message: completedFullDuration ? "อ่านครบเวลาแล้ว!" : "จบรอบก่อนครบเวลา คิดคอยน์ตามเวลาที่อ่านจริง",
      chapterId: session.chapter_id,
      chapterTitle: session.chapter_title,
      elapsedSeconds,
      awaySeconds,
      readSeconds: effectiveElapsedSeconds,
      plannedReadSeconds: session.planned_read_seconds,
      completedFullDuration,
      coinsEarned,
      coinsPending: !!pending,
      capped,
      chapterRewardLimitReached,
      roundsUsed,
      roundsCap: cap === null ? null : rules.dailyCoinRounds,
      totalCoins: user.coins,
      progress,
      petHappinessGained,
      streak,
      pages: await pageSummary(sessionId),
    });
  } catch (err) {
    console.error("Complete reading session error:", err);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์" });
  }
});

// ---------- POST /api/sessions/:sessionId/away ----------
// หน้าเว็บเรียกตอนผู้ใช้ออกจากหน้าอ่าน (สลับแท็บ/ย่อหน้าต่าง) เริ่มจับเวลาที่ไม่นับเป็นเวลาอ่าน
// body { idleSeconds }: ไม่ได้ขยับเมาส์/เลื่อนหน้ามานานแล้ว — นับย้อนไปตั้งแต่ขยับครั้งสุดท้าย (ไม่ก่อนเริ่มรอบ)
const MAX_IDLE_BACKDATE_SECONDS = 3600;
router.post("/:sessionId/away", requireAuth, async (req, res, next) => {
  try {
    const idleSeconds = Math.min(MAX_IDLE_BACKDATE_SECONDS, Math.max(0, Math.floor(Number(req.body?.idleSeconds) || 0)));
    await db.prepare(
      `UPDATE reading_sessions SET away_started_at = MAX(started_at, datetime('now', ?)), away_is_idle = ?
       WHERE id = ? AND user_id = ? AND status = 'in_progress' AND away_started_at IS NULL`
    ).run(`-${idleSeconds} seconds`, idleSeconds > 0 ? 1 : 0, Number(req.params.sessionId), req.user.id);
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
      .prepare("SELECT user_id, status, away_seconds, away_started_at, away_is_idle FROM reading_sessions WHERE id = ?")
      .get(sessionId);

    if (!session || session.user_id !== req.user.id) {
      return res.status(404).json({ message: "ไม่พบเซสชันการอ่านนี้" });
    }
    if (session.status !== "in_progress" || !session.away_started_at) {
      return res.json({ awaySeconds: 0, totalAwaySeconds: session.away_seconds });
    }

    const awaySeconds = secondsSince(session.away_started_at);
    // guard ด้วย away_started_at เดิม กันเรียก back ซ้อนกันแล้วบวกช่วงเดียวกันสองรอบ
    // ช่วงที่ไม่ขยับ (away_is_idle) รวมอยู่ใน away_seconds ด้วย และแยกเก็บใน idle_seconds ไว้ทำสถิติ
    const idleAdded = session.away_is_idle ? awaySeconds : 0;
    const result = await db.prepare(
      `UPDATE reading_sessions SET away_seconds = away_seconds + ?, idle_seconds = idle_seconds + ?,
              away_started_at = NULL, away_is_idle = 0
       WHERE id = ? AND away_started_at = ?`
    ).run(awaySeconds, idleAdded, sessionId, session.away_started_at);

    const added = result.changes === 0 ? 0 : awaySeconds;
    return res.json({ awaySeconds: added, totalAwaySeconds: session.away_seconds + added });
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
    if (session.status !== "in_progress") {
      return res.status(400).json({ message: "เซสชันนี้จบไปแล้ว หรือถูกยกเลิกไปแล้ว" });
    }

    await db.prepare(
      "UPDATE reading_sessions SET status = 'cancelled', ended_at = datetime('now') WHERE id = ? AND status = 'in_progress'"
    ).run(sessionId);

    return res.json({ message: "ยกเลิกเซสชันการอ่านแล้ว" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
