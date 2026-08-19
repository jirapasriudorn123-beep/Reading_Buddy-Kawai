const express = require("express");
const db = require("../db/database");
const { requireAuth } = require("../middleware/auth");
const { askGemini } = require("../services/gemini");

const router = express.Router();

// ================== แชทบอทน้องหมา ==================
// 1) ทักทาย/ขอบคุณ → ตอบตามกฎแบบสั้น
// 2) ไม่เกี่ยวกับสุนัข/บทเรียน → ปฏิเสธ
// 3) เข้าคำตอบใน DB (chat_answers ที่แอดมินกรอกไว้) → ตอบตามนั้น
// 4) ถามด้วยเลขบท → ตอบข้อมูลบทตรงๆ
// 5) เข้าเรื่องสุนัข/บทเรียนแต่ไม่มีคำตอบ → ยิงเข้า Gemini พร้อม context

const MAX_MESSAGE_LENGTH = 500;

function formatMinutes(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m} นาที ${s} วินาที` : `${m} นาที`;
}

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
  return `Chapter ${chapter.chapter_number}: ${chapter.title} ครับ 📖${detail}\n\nอ่านจบแล้วได้เหรียญตามเวลาที่อ่านจริงเลยนะครับ (10 เหรียญต่อทุกๆ 5 นาที)`;
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

// ---- Fallback: ส่งคำถามให้ Gemini ตอบ พร้อม context ของ user/pet/chapter ----
async function buildGeminiReply(message, context) {
  const chapterInfo = context.currentChapter
    ? `ผู้ใช้กำลังอ่าน:
Chapter ${context.currentChapter.chapter_number}: ${context.currentChapter.title}

เนื้อหาบท:
${context.currentChapter.detail || "ไม่มีรายละเอียดเพิ่มเติม"}`
    : "ตอนนี้ผู้ใช้ไม่ได้เปิดบทเรียนอยู่";

  const petInfo = context.pet
    ? `ข้อมูลน้องหมาของผู้ใช้:
ชื่อ: ${context.pet.name}
พันธุ์: ${context.pet.breed}
ความอิ่ม: ${context.pet.hunger}%
ความสะอาด: ${context.pet.cleanliness}%
ความสุข: ${context.pet.happiness}%
พลังงาน: ${context.pet.energy}%`
    : "ผู้ใช้ยังไม่มีข้อมูลน้องหมา";

  const goalInfo = context.goal && (context.goal.goal_minutes || context.goal.goal_seconds)
    ? `เป้าหมายเวลาอ่านต่อวัน: ${formatMinutes(context.goal.goal_minutes * 60 + context.goal.goal_seconds)}`
    : "ผู้ใช้ยังไม่ได้ตั้งเป้าหมายเวลาอ่าน";

  const prompt = `คุณคือ "น้องหมาผู้ช่วย" ของเว็บไซต์ Reading Buddy 🐶📖

ขอบเขตการตอบ — ตอบได้เฉพาะ 2 เรื่องนี้เท่านั้น:
1. เรื่องสุนัขทุกด้าน — พันธุ์ (ชิบะ โกลเด้น พูเดิ้ล ฯลฯ), นิสัย, การดูแล, อาหาร, สุขภาพ, การฝึก, พฤติกรรม
2. เรื่องบทเรียนและการอ่านหนังสือ (เนื้อหาที่ระบบให้มาเป็นหลัก)

ถ้าคำถามไม่เกี่ยวกับ 2 เรื่องนี้ (เช่น เขียนโค้ด, คำนวณคณิตศาสตร์, ข่าว, ประวัติศาสตร์, บันเทิง)
ให้ตอบสั้นๆ ปฏิเสธว่า:
"ขอโทษครับ 🐶 ผมตอบได้เฉพาะเรื่องน้องหมาและบทเรียนเท่านั้นครับ 📖🐾"

กฎการตอบ:
- ตอบเป็นภาษาไทย เป็นกันเอง ใช้คำแทนตัวว่า "ผม"
- ห้ามสร้างข้อมูลส่วนตัวของผู้ใช้ขึ้นมาเอง
- ถ้าถามสถานะน้องหมา/บทเรียน ให้ใช้ข้อมูลที่ระบบให้มาเท่านั้น อย่ามั่วเอง
- ถ้าข้อมูลไม่พอ ให้บอกตรงๆ ว่ายังไม่มีข้อมูล
- ตอบกระชับ ไม่ยืดเยื้อ

${petInfo}

${chapterInfo}

${goalInfo}

คำถามของผู้ใช้:
${message}`;

  return await askGemini(prompt);
}

async function buildReply(message, context) {
  const lower = message.toLowerCase();

  // 1) กฎทักทาย/ขอบคุณ (ตอบสั้นๆ ไม่ต้องเปลือง Gemini)
  const basicRule = BASIC_RULES.find((r) => r.keywords.some((k) => lower.includes(k.toLowerCase())));
  if (basicRule) return basicRule.reply(context);

  // 2) คำตอบที่แอดมินกรอกไว้ (ตอบก่อน Gemini เพราะเป็นเนื้อหาที่คนคุมเนื้อหาตั้งใจใส่มา)
  const authored = await findChatAnswer(
    message,
    context.currentChapter ? context.currentChapter.id : null
  );
  if (authored) {
    const source = authored.chapterNumber
      ? `\n\n📖 อ้างอิงจาก Chapter ${authored.chapterNumber}: ${authored.chapterTitle}`
      : "";
    return `${authored.answer}${source}`;
  }

  // 3) ถามด้วยเลขบท เช่น "บทที่ 3"
  const chapterReply = matchChapterNumber(message, context.chapters);
  if (chapterReply) return chapterReply;

  // 4) Fallback → Gemini (Gemini prompt เป็นคนตัดสินเองว่านอกสโคปหรือไม่
  //    ดีกว่า keyword filter ที่ block คำเกี่ยวกับหมาเพราะไม่มีคำตรงเป๊ะ เช่น "ชิบะนิสัยยังไง")
  try {
    return await buildGeminiReply(message, context);
  } catch (err) {
    console.error("Gemini fallback error:", err);
    return "ขอโทษครับ ตอนนี้น้อง AI ไม่สามารถตอบได้ชั่วคราว 🐶 กรุณาลองใหม่อีกครั้งนะครับ";
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

    const reply = await buildReply(message.trim(), context);
    return res.json({ reply });
  } catch (err) {
    console.error("Chat message error:", err);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์" });
  }
});

module.exports = { router, findChatAnswer };
