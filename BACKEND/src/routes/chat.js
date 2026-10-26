const express = require("express");
const db = require("../db/database");
const { requireAuth } = require("../middleware/auth");
const { expireStalePendingCoins } = require("../services/chapterTests");
const { askTutor } = require("../services/aiTutor");
const { DAILY_AI_LIMIT, LEVEL_UP_AI_BONUS, consumeAiQuota, refundAiQuota, getAiQuotaStatus } = require("../services/aiQuota");

const router = express.Router();

// ================== แชทบอทน้องหมา ==================
// 1) ทักทาย/ขอบคุณ → ตอบตามกฎแบบสั้น
// 2) ไม่เกี่ยวกับสุนัข/บทเรียน → ปฏิเสธ
// 3) เข้าคำตอบใน DB (chat_answers ที่แอดมินกรอกไว้) → ตอบตามนั้น
// 4) ถามด้วยเลขบท → ตอบข้อมูลบทตรงๆ
// 5) เข้าเรื่องสุนัข/บทเรียนแต่ไม่มีคำตอบ → ยิงเข้า Gemini พร้อม context

const MAX_MESSAGE_LENGTH = 500;
const HISTORY_LIMIT = 50; // โหลดประวัติย้อนหลังกี่คู่คำถาม-คำตอบตอนเปิดแชท

const STAT_LABELS = {
  hunger: "ความอิ่ม",
  cleanliness: "ความสะอาด",
  happiness: "ความสุข",
  energy: "พลังงาน",
};

const STAT_ADVICE = {
  hunger: "กดปุ่มให้อาหารแล้วเลือกไอเทมจากกระเป๋าอาหารได้เลย",
  cleanliness: "พาน้องไปอาบน้ำหน่อยนะ กดปุ่มอาบน้ำแล้วเลือกสบู่หรือแชมพู",
  happiness: "ลองกดค้างที่ตัวน้องเพื่อลูบหัว หรือเปิดกระเป๋าของเล่นมาเล่นด้วยกัน",
  energy: "ให้น้องนอนพักหน่อย กดปุ่มนอนแล้วเลือกผ้าห่มหรือหมอนได้เลย",
};

// ---- ดึงข้อมูล user + pet + chapters + goal มาใช้ประกอบคำตอบและ context ให้ Gemini ----
async function loadContext(userId, chapterId) {
  const [user, pet, chapters, goal, currentChapter] = await Promise.all([
    db.prepare("SELECT username, coins FROM users WHERE id = ?").get(userId),
    db
      .prepare("SELECT name, breed, hunger, cleanliness, happiness, energy, care_points FROM pets WHERE user_id = ?")
      .get(userId),
    db
      .prepare("SELECT chapter_number, title, coin_reward, detail FROM chapters ORDER BY chapter_number ASC")
      .all(),
    db.prepare("SELECT goal_minutes, goal_seconds FROM reading_goals WHERE user_id = ?").get(userId),
    chapterId
      ? db.prepare("SELECT id, chapter_number, title, detail FROM chapters WHERE id = ?").get(chapterId)
      : Promise.resolve(null),
  ]);

  return { user, pet, chapters, goal, currentChapter };
}

// ---- กฎตอบทักทาย/ขอบคุณ (เอาไว้ไม่ต้องไปเปลืองโควต้า Gemini กับคำทั่วไป) ----
const BASIC_RULES = [
  {
    keywords: ["สวัสดี", "หวัดดี", "ดีจ้า", "hello", "hi", "โฮ่ง"],
    reply: ({ user }) => `โฮ่ง! สวัสดีครับคุณ${user.username} 🐶 วันนี้อยากให้ผมช่วยเรื่องอะไรดีครับ?`,
  },
  {
    keywords: ["ขอบคุณ", "ขอบใจ", "thank"],
    reply: () => "ยินดีเสมอเลยครับ! 🐾 มีอะไรอีกถามผมได้ตลอดนะ",
  },
];

// ---- ถามจำนวนเหรียญของตัวเอง → ตอบจากฐานข้อมูลจริง (ไม่ต้องให้ AI เดา และไม่เปลืองโควต้า) ----
const COIN_WORDS = /เหรียญ|คอยน์|coin/i;
const AMOUNT_WORDS = /กี่|เท่าไร|เท่าไหร่|เหลือ|ตอนนี้มี|how many|balance/i;

async function coinBalanceReply(message, context, userId) {
  if (!COIN_WORDS.test(message) || !AMOUNT_WORDS.test(message)) return null;
  await expireStalePendingCoins(userId); // คอยน์ค้างข้ามวันหมดอายุแล้ว ไม่นับ
  const pending = await db
    .prepare(
      `SELECT COALESCE(SUM(coins_earned), 0) AS coins FROM reading_sessions
       WHERE user_id = ? AND status = 'completed' AND coins_pending = 1`
    )
    .get(userId);
  const pendingText = pending.coins > 0
    ? `
มีอีก ${pending.coins} เหรียญจากเวลาอ่านที่รอปลดล็อก ทำแบบทดสอบหลังอ่านบทนั้นผ่านภายในวันนี้แล้วจะได้เลย (ผ่านเร็วได้โบนัสมากกว่า)`
    : "";
  return `ตอนนี้คุณมี ${context.user.coins} เหรียญครับ 🪙${pendingText}

ใช้ซื้อของให้น้องหมาหรือแลกคูปองได้ที่หน้าร้านค้านะครับ 🐾`;
}

// ถามถึงบทเรียนด้วยเลขบท เช่น "บทที่ 3" / "chapter 5"
function matchChapterNumber(message, chapters) {
  const hasChapterWord = /บท|chapter|ch\./i.test(message);
  if (!hasChapterWord) return null;

  const numberMatch = message.match(/\d+/);
  if (!numberMatch) return null;

  const chapter = chapters.find((c) => c.chapter_number === Number(numberMatch[0]));
  if (!chapter) {
    return `ยังไม่มีบทที่ ${numberMatch[0]} ในระบบเลยครับ ตอนนี้มีบทที่ 1 ถึง ${chapters.length} เท่านั้นนะ 📚`;
  }

  const detail = chapter.detail ? `\n\n${chapter.detail}` : "";
  return `Chapter ${chapter.chapter_number}: ${chapter.title} ครับ 📖${detail}\n\nอ่านรอบละ 25 นาทีแล้วพัก 5 นาที ได้ 10 เหรียญทุกๆ 5 นาทีที่อ่านจริง เหรียญจะเข้าหลังทำแบบทดสอบหลังอ่านบทนี้ ผ่านครั้งแรกได้โบนัสเพิ่ม 30 เหรียญนะครับ`;
}

// ---- คลังคำตอบที่แอดมินกรอกไว้ (ตาราง chat_answers) ----
// "คำสำคัญที่ยาวที่สุดชนะ" เพราะภาษาไทยไม่มีช่องว่าง คำสั้นๆ ซ่อนอยู่ในคำอื่นได้ง่าย
async function findChatAnswer(message, currentChapterId = null) {
  const lower = message.toLowerCase();

  const rows = await db
    .prepare(
      `SELECT ca.id, ca.chapter_id, ca.keywords, ca.answer, c.chapter_number, c.title AS chapter_title
       FROM chat_answers ca
       LEFT JOIN chapters c ON c.id = ca.chapter_id
       ORDER BY ca.id ASC`
    )
    .all();

  let best = null;

  for (const row of rows) {
    for (const keyword of row.keywords.split(",")) {
      const trimmed = keyword.trim();
      if (!trimmed || !lower.includes(trimmed.toLowerCase())) continue;

      const candidate = {
        id: row.id,
        answer: row.answer,
        matchedKeyword: trimmed,
        chapterNumber: row.chapter_number,
        chapterTitle: row.chapter_title,
        score: trimmed.length,
        isCurrentChapter: currentChapterId != null && row.chapter_id === currentChapterId,
      };

      if (
        !best ||
        candidate.score > best.score ||
        (candidate.score === best.score && candidate.isCurrentChapter && !best.isCurrentChapter)
      ) {
        best = candidate;
      }
    }
  }

  return best;
}

// ---- Fallback: ส่งคำถามให้ Gemini ตอบ พร้อม context ของ user/pet/chapter (prompt + การตั้งค่าอยู่ใน services/aiTutor.js) ----
async function buildGeminiReply(message, context) {
  const { text } = await askTutor(message, context);
  return text;
}

// คืน { reply, source } — source บอกว่าคำตอบมาจากไหน (เก็บลง chat_history ใช้แยกคำถามที่ถาม AI จริงตอนวิเคราะห์)
async function buildReply(message, context, userId) {
  const lower = message.toLowerCase();

  // 1) กฎทักทาย/ขอบคุณ (ตอบสั้นๆ ไม่ต้องเปลือง Gemini)
  const basicRule = BASIC_RULES.find((r) => r.keywords.some((k) => lower.includes(k.toLowerCase())));
  if (basicRule) return { reply: basicRule.reply(context), source: "rule" };

  // 1.5) ถามจำนวนเหรียญของตัวเอง → ตอบจากข้อมูลจริง
  const coinReply = await coinBalanceReply(message, context, userId);
  if (coinReply) return { reply: coinReply, source: "rule" };

  // 2) คำตอบที่แอดมินกรอกไว้ (ตอบก่อน Gemini เพราะเป็นเนื้อหาที่คนคุมเนื้อหาตั้งใจใส่มา)
  const authored = await findChatAnswer(
    message,
    context.currentChapter ? context.currentChapter.id : null
  );
  if (authored) {
    const source = authored.chapterNumber
      ? `\n\n📖 อ้างอิงจาก Chapter ${authored.chapterNumber}: ${authored.chapterTitle}`
      : "";
    return { reply: `${authored.answer}${source}`, source: "authored" };
  }

  // 3) ถามด้วยเลขบท เช่น "บทที่ 3"
  const chapterReply = matchChapterNumber(message, context.chapters);
  if (chapterReply) return { reply: chapterReply, source: "chapter_info" };

  // 4) Fallback → Gemini (Gemini prompt เป็นคนตัดสินเองว่านอกสโคปหรือไม่
  //    ดีกว่า keyword filter ที่ block คำเกี่ยวกับหมาเพราะไม่มีคำตรงเป๊ะ เช่น "ชิบะนิสัยยังไง")
  //    เฉพาะขั้นนี้ที่นับโควต้าถาม AI (ขั้น 1-3 ตอบเองได้ ไม่เปลือง Gemini)
  const quotaSource = await consumeAiQuota(userId);
  if (!quotaSource) {
    return {
      reply:
        `วันนี้ถามน้อง AI ครบ ${DAILY_AI_LIMIT} ข้อแล้วครับ 🐶💤 พรุ่งนี้มาถามใหม่ได้นะครับ\n\n` +
        `💡 ดูแลน้องหมาจนเลเวลอัพ จะได้คำถาม AI ฟรีเพิ่ม +${LEVEL_UP_AI_BONUS} ข้อต่อเลเวล`,
      source: "quota_exceeded",
    };
  }
  try {
    return { reply: await buildGeminiReply(message, context), source: "gemini" };
  } catch (err) {
    console.error("Gemini fallback error:", err);
    await refundAiQuota(userId, quotaSource);
    return { reply: "ขอโทษครับ ตอนนี้น้อง AI ไม่สามารถตอบได้ชั่วคราว 🐶 กรุณาลองใหม่อีกครั้งนะครับ", source: "error" };
  }
}

// ---------- POST /api/chat/message ----------
router.post("/message", requireAuth, async (req, res) => {
  try {
    const { message, chapterId } = req.body;

    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ message: "กรุณาพิมพ์ข้อความก่อนส่งนะครับ" });
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ message: `ข้อความยาวเกินไป (สูงสุด ${MAX_MESSAGE_LENGTH} ตัวอักษร)` });
    }

    const context = await loadContext(req.user.id, Number(chapterId) || null);
    if (!context.user) {
      return res.status(404).json({ message: "ไม่พบผู้ใช้งาน" });
    }

    const question = message.trim();
    const { reply, source } = await buildReply(question, context, req.user.id);
    // ข้อมูลวิจัย: ถามระหว่างจับเวลาอ่านรอบไหนอยู่ (ใช้เทียบรอบที่ถาม AI กับรอบที่ไม่ได้ถาม)
    const readingSession = await db
      .prepare("SELECT id FROM reading_sessions WHERE user_id = ? AND status = 'in_progress' ORDER BY id DESC LIMIT 1")
      .get(req.user.id);
    // เก็บประวัติไว้ให้เปิดแชทครั้งหน้า/หน้าอื่นแล้วเห็นบทสนทนาเดิม (บันทึกไม่สำเร็จก็ยังตอบผู้ใช้ตามปกติ)
    await db
      .prepare(
        `INSERT INTO chat_history (user_id, question, answer, source, chapter_id, reading_session_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        req.user.id,
        question,
        reply,
        source,
        context.currentChapter ? context.currentChapter.id : null,
        readingSession ? readingSession.id : null
      )
      .catch((err) => console.error("Save chat history error:", err));
    const aiQuota = await getAiQuotaStatus(req.user.id);
    return res.json({ reply, aiQuota });
  } catch (err) {
    console.error("Chat message error:", err);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์" });
  }
});

// ---------- GET /api/chat/history ----------
// ประวัติแชทล่าสุดของผู้ใช้ เรียงเก่า → ใหม่ (หน้าแชทเอาไปแสดงต่อกันตามลำดับ)
router.get("/history", requireAuth, async (req, res, next) => {
  try {
    const rows = await db
      .prepare(
        `SELECT question, answer, created_at AS createdAt FROM chat_history
         WHERE user_id = ? ORDER BY id DESC LIMIT ?`
      )
      .all(req.user.id, HISTORY_LIMIT);
    return res.json({ history: rows.reverse() });
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/chat/quota ----------
// โควต้าถาม AI ที่เหลือวันนี้ + เครดิตโบนัส (โชว์ในหัวแชท)
router.get("/quota", requireAuth, async (req, res, next) => {
  try {
    return res.json(await getAiQuotaStatus(req.user.id));
  } catch (err) {
    next(err);
  }
});

module.exports = { router, findChatAnswer };
