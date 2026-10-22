// ================== เพิ่มคำถามมินิเกมชุดเพิ่มเข้าฐานข้อมูลที่มีคำถามอยู่แล้ว ==================
// seed-quiz-questions.js ข้ามตารางที่มีข้อมูลแล้ว สคริปต์นี้จึงเติมเฉพาะชุดใน quiz-questions-extra.js
// รัน: node scripts/add-extra-quiz-questions.js (จาก BACKEND/)
// ข้ามข้อที่มีคำถามข้อความเดียวกันอยู่แล้วในบท/พันธุ์นั้น — รันซ้ำได้ไม่เพิ่มซ้ำ

require("dotenv").config();
const db = require("../src/db/database");
const { EXTRA_QUIZ_BY_CHAPTER, EXTRA_QUIZ_BY_BREED } = require("./quiz-questions-extra");

async function addChapterQuestions() {
  for (const [chapterNumber, items] of Object.entries(EXTRA_QUIZ_BY_CHAPTER)) {
    const chapter = await db.prepare("SELECT id FROM chapters WHERE chapter_number = ?").get(Number(chapterNumber));
    if (!chapter) {
      console.warn(`ไม่พบ chapter_number ${chapterNumber} ในตาราง chapters — ข้ามคำถามชุดนี้`);
      continue;
    }
    const existing = await db.prepare("SELECT question FROM quiz_questions WHERE chapter_id = ?").all(chapter.id);
    const have = new Set(existing.map((r) => r.question));
    let added = 0;
    for (const item of items) {
      if (have.has(item.q)) continue;
      await db
        .prepare(
          `INSERT INTO quiz_questions (chapter_id, level, question, option_1, option_2, option_3, option_4, correct_option)
           VALUES (?, 1, ?, ?, ?, ?, ?, ?)`
        )
        .run(chapter.id, item.q, item.opts[0], item.opts[1], item.opts[2], item.opts[3], item.a + 1);
      added++;
    }
    console.log(`บทที่ ${chapterNumber}: เพิ่ม ${added} ข้อ (รวมในคลัง ${existing.length + added} ข้อ)`);
  }
}

async function addBreedQuestions() {
  for (const [breed, items] of Object.entries(EXTRA_QUIZ_BY_BREED)) {
    const existing = await db.prepare("SELECT question FROM breed_quiz_questions WHERE breed = ?").all(breed);
    const have = new Set(existing.map((r) => r.question));
    let added = 0;
    for (const item of items) {
      if (have.has(item.q)) continue;
      await db
        .prepare(
          `INSERT INTO breed_quiz_questions (breed, question, option_1, option_2, option_3, option_4, correct_option)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(breed, item.q, item.opts[0], item.opts[1], item.opts[2], item.opts[3], item.a + 1);
      added++;
    }
    console.log(`พันธุ์ ${breed}: เพิ่ม ${added} ข้อ (รวมในคลัง ${existing.length + added} ข้อ)`);
  }
}

(async () => {
  await addChapterQuestions();
  await addBreedQuestions();
  console.log("เสร็จสิ้น");
  process.exit(0);
})().catch((err) => {
  console.error("เพิ่มคำถามล้มเหลว:", err);
  process.exit(1);
});
