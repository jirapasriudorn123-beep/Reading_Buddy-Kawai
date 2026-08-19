const express = require("express");
const db = require("../db/database");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

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

async function loadContext(userId, chapterId) {
  const [user, pet, chapters, goal, currentChapter, cheapestProducts] = await Promise.all([
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
    db.prepare("SELECT name, price, category FROM products ORDER BY price ASC LIMIT 5").all(),
  ]);

  return { user, pet, chapters, goal, currentChapter, cheapestProducts };
}

const RULES = [
  {
    keywords: ["สวัสดี", "หวัดดี", "ดีจ้า", "hello", "hi", "โฮ่ง"],
    reply: ({ user }) => `โฮ่ง! สวัสดีครับคุณ${user.username} 🐶 วันนี้อยากให้ผมช่วยเรื่องอะไรดีครับ?`,
  },
  {
    keywords: ["ขอบคุณ", "ขอบใจ", "thank"],
    reply: () => "ยินดีเสมอเลยครับ! 🐾 มีอะไรอีกถามผมได้ตลอดนะ",
  },
  {
    keywords: ["บทนี้", "กำลังอ่าน", "อ่านอะไรอยู่", "เรื่องนี้"],
    reply: ({ currentChapter }) => {
      if (!currentChapter) {
        return "ตอนนี้คุณยังไม่ได้เปิดอ่านบทไหนอยู่เลยครับ ลองกดการ์ดบทเรียนในหน้าแรกเพื่อเริ่มจับเวลาอ่านดูนะ 📖";
      }
      const detail = currentChapter.detail ? `\n\n${currentChapter.detail}` : "";
      return `ตอนนี้คุณกำลังอ่าน Chapter ${currentChapter.chapter_number}: ${currentChapter.title} อยู่ครับ 📖${detail}\n\nสู้ๆ นะครับ ผมเป็นกำลังใจให้! 🐾`;
    },
  },
  {
    keywords: ["บทเรียน", "บทไหน", "มีกี่บท", "chapter", "เนื้อหา", "หัวข้อ"],
    reply: ({ chapters }) => {
      const list = chapters.map((c) => `${c.chapter_number}. ${c.title}`).join("\n");
      return `ตอนนี้มีบทเรียนทั้งหมด ${chapters.length} บทครับ 📚\n\n${list}\n\nอยากรู้รายละเอียดบทไหนพิมพ์เลขบทมาได้เลยครับ เช่น "บทที่ 3"`;
    },
  },
  {
    keywords: ["เหรียญ", "คอยน์", "coin", "เงิน"],
    reply: ({ user }) =>
      `ตอนนี้คุณมี ${user.coins} เหรียญครับ 🪙\n\n` +
      `วิธีหาเหรียญเพิ่ม: อ่านหนังสือให้ครบทุกๆ 5 นาทีจะได้ 10 เหรียญครับ ` +
      `(ถ้าอ่านไม่ครบ 5 นาทีในรอบนั้นจะยังไม่ได้เหรียญของรอบนั้นนะ) ยิ่งอ่านนานยิ่งได้เยอะเลย!`,
  },
  {
    keywords: ["เป้าหมาย", "goal", "ตั้งเวลา", "เป้า"],
    reply: ({ goal }) => {
      if (!goal || (goal.goal_minutes === 0 && goal.goal_seconds === 0)) {
        return "คุณยังไม่ได้ตั้งเป้าหมายเวลาอ่านเลยครับ ⏱️\n\nกดปุ่มตั้งเป้าหมายที่หน้าแรกได้เลย ตั้งได้สูงสุด 120 นาทีครับ";
      }
      const total = goal.goal_minutes * 60 + goal.goal_seconds;
      return `เป้าหมายเวลาอ่านของคุณตอนนี้คือ ${formatMinutes(total)} ต่อวันครับ ⏱️\n\nดูความคืบหน้าเทียบกับเป้าหมายได้ที่หน้า Dashboard เลยนะครับ`;
    },
  },
  {
    keywords: ["น้องหมา", "สัตว์เลี้ยง", "สุนัข", "เจ้าตูบ", "สถานะ", "หิว", "อาบน้ำ", "เลเวล", "level", "ดูแล"],
    reply: ({ pet }) => {
      if (!pet) {
        return "คุณยังไม่ได้เลือกน้องหมาเลยครับ 🐕 ไปที่หน้าเลือกสัตว์เลี้ยงเพื่อเลือกพันธุ์และตั้งชื่อให้น้องก่อนนะครับ";
      }

      const statLines = Object.keys(STAT_LABELS)
        .map((key) => `• ${STAT_LABELS[key]}: ${pet[key]}%`)
        .join("\n");

      const lowStats = Object.keys(STAT_LABELS).filter((key) => pet[key] < 25);
      const advice = lowStats.length
        ? `\n\n⚠️ ${lowStats.map((k) => STAT_LABELS[k]).join(" และ ")} ต่ำมากแล้ว! ${STAT_ADVICE[lowStats[0]]}`
        : "\n\nตอนนี้น้องสบายดีเลยครับ ดูแลดีมาก! 💚";

      return `น้อง${pet.name} (เลเวล ${pet.care_points}) ตอนนี้เป็นแบบนี้ครับ 🐶\n\n${statLines}${advice}`;
    },
  },
  {
    keywords: ["ร้าน", "ซื้อ", "ขาย", "shop", "ของเล่น", "อาหาร", "ราคา", "สินค้า"],
    reply: ({ cheapestProducts }) => {
      const list = cheapestProducts.map((p) => `• ${p.name} (${p.category}) — ${p.price} เหรียญ`).join("\n");
      return `ในร้านมีของให้เลือกเยอะเลยครับ 🛍️ ตัวอย่างของที่ราคาย่อมเยา:\n\n${list}\n\nเข้าไปดูทั้งหมดได้ที่หน้าร้านค้าเลยครับ ใช้เหรียญที่ได้จากการอ่านซื้อได้เลย!`;
    },
  },
  {
    keywords: ["เกม", "game", "ด่าน", "เล่น", "ผจญภัย"],
    reply: () =>
      "เกม Phayao Adventure เข้าได้จากหน้าน้องหมาครับ 🎮 กดที่ไอคอนเกมได้เลย\n\n" +
      "ในเกมจะมีทั้งหมด 6 โลก โลกละ 4 ด่าน เล่นผ่านแล้วจะปลดล็อคด่านถัดไปเรื่อยๆ ครับ",
  },
  {
    keywords: ["รหัสผ่าน", "password", "ลืมรหัส", "เปลี่ยนรหัส"],
    reply: () =>
      "เรื่องรหัสผ่านทำได้ 2 แบบครับ 🔑\n\n" +
      "• ถ้าจำรหัสเดิมได้: ไปที่หน้าตั้งค่า แล้วกดเปลี่ยนรหัสผ่าน (ต้องกรอกรหัสเดิมยืนยันก่อน)\n" +
      "• ถ้าลืมรหัส: กดลืมรหัสผ่านที่หน้าเข้าสู่ระบบ ระบบจะส่งลิงก์ไปที่อีเมลให้ ลิงก์มีอายุ 15 นาทีครับ",
  },
  {
    keywords: ["ใช้ยังไง", "วิธีใช้", "ทำยังไง", "เริ่มยังไง", "ช่วย", "help", "แนะนำ"],
    reply: () =>
      "ผมช่วยได้หลายเรื่องเลยครับ 🐾 ลองถามผมแบบนี้ได้:\n\n" +
      '• "มีบทเรียนอะไรบ้าง"\n' +
      '• "บทที่ 3 เกี่ยวกับอะไร"\n' +
      '• "ตอนนี้มีเหรียญเท่าไหร่"\n' +
      '• "น้องหมาเป็นยังไงบ้าง"\n' +
      '• "เป้าหมายการอ่านของฉัน"\n' +
      '• "ในร้านมีอะไรขายบ้าง"',
  },
];

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

async function buildReply(message, context) {
  const authored = await findChatAnswer(message, context.currentChapter ? context.currentChapter.id : null);
  if (authored) {
    const source = authored.chapterNumber ? `\n\n📖 อ้างอิงจาก Chapter ${authored.chapterNumber}: ${authored.chapterTitle}` : "";
    return `${authored.answer}${source}`;
  }

  const chapterReply = matchChapterNumber(message, context.chapters);
  if (chapterReply) return chapterReply;

  const lower = message.toLowerCase();
  const rule = RULES.find((r) => r.keywords.some((k) => lower.includes(k.toLowerCase())));
  if (rule) return rule.reply(context);

  return (
    "ขอโทษครับ ผมยังไม่เข้าใจคำถามนี้ 🐶 ผมตอบได้เฉพาะเรื่องที่มีคนสอนผมไว้เท่านั้นครับ\n\n" +
    "ลองถามผมเรื่องบทเรียน เหรียญ น้องหมา เป้าหมายการอ่าน ร้านค้า หรือเกมดูนะครับ " +
    'หรือพิมพ์ว่า "ช่วยหน่อย" ผมจะบอกตัวอย่างคำถามให้ครับ'
  );
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
