const db = require("../db/database");

// ================== โควต้าถาม AI (Gemini) ==================
// นับเฉพาะคำถามที่ต้องส่งให้ Gemini ตอบจริง (ทักทาย/คำตอบที่แอดมินกรอก/ถามเลขบท ไม่นับ)
// ใช้โควต้ารายวันก่อน หมดแล้วค่อยใช้เครดิตโบนัสจากน้องหมาเลเวลอัพ

const DAILY_AI_LIMIT = 8;
const LEVEL_UP_AI_BONUS = 3; // ได้เครดิตถามฟรีต่อ 1 เลเวลที่ขึ้น

// วันที่ตามเวลาไทย (UTC+7) — ขึ้นวันใหม่ตอนเที่ยงคืนไทย ไม่ใช่ 7 โมงเช้า
const TODAY_SQL = "date('now', '+7 hours')";

// ใช้โควต้า 1 ข้อ คืน 'daily' | 'bonus' | null (หมดทั้งคู่)
// ทุกขั้นเป็น UPDATE แบบมีเงื่อนไข กันส่งพร้อมกันหลายแท็บแล้วเกินโควต้า
async function consumeAiQuota(userId) {
  await db
    .prepare(`INSERT INTO ai_daily_usage (user_id, day, count) VALUES (?, ${TODAY_SQL}, 0) ON CONFLICT(user_id, day) DO NOTHING`)
    .run(userId);

  const daily = await db
    .prepare(`UPDATE ai_daily_usage SET count = count + 1 WHERE user_id = ? AND day = ${TODAY_SQL} AND count < ?`)
    .run(userId, DAILY_AI_LIMIT);
  if (daily.changes > 0) return "daily";

  const bonus = await db
    .prepare("UPDATE users SET ai_bonus_credits = ai_bonus_credits - 1 WHERE id = ? AND ai_bonus_credits > 0")
    .run(userId);
  if (bonus.changes > 0) return "bonus";

  return null;
}

// Gemini ตอบไม่สำเร็จ → คืนโควต้าที่เพิ่งหักไป (ไม่ให้ผู้ใช้เสียสิทธิ์ฟรีๆ)
async function refundAiQuota(userId, source) {
  if (source === "daily") {
    await db
      .prepare(`UPDATE ai_daily_usage SET count = MAX(0, count - 1) WHERE user_id = ? AND day = ${TODAY_SQL}`)
      .run(userId);
  } else if (source === "bonus") {
    await db.prepare("UPDATE users SET ai_bonus_credits = ai_bonus_credits + 1 WHERE id = ?").run(userId);
  }
}

async function getAiQuotaStatus(userId) {
  const [usage, user] = await Promise.all([
    db.prepare(`SELECT count FROM ai_daily_usage WHERE user_id = ? AND day = ${TODAY_SQL}`).get(userId),
    db.prepare("SELECT ai_bonus_credits FROM users WHERE id = ?").get(userId),
  ]);
  const usedToday = usage ? usage.count : 0;
  return {
    dailyLimit: DAILY_AI_LIMIT,
    usedToday,
    remainingToday: Math.max(0, DAILY_AI_LIMIT - usedToday),
    bonusCredits: user ? user.ai_bonus_credits : 0,
  };
}

// น้องหมาเลเวลอัพ → เพิ่มเครดิตถาม AI ฟรี คืนจำนวนที่ได้
async function grantLevelUpAiBonus(userId, levelsGained) {
  if (levelsGained <= 0) return 0;
  const amount = levelsGained * LEVEL_UP_AI_BONUS;
  await db.prepare("UPDATE users SET ai_bonus_credits = ai_bonus_credits + ? WHERE id = ?").run(amount, userId);
  return amount;
}

module.exports = {
  DAILY_AI_LIMIT,
  LEVEL_UP_AI_BONUS,
  consumeAiQuota,
  refundAiQuota,
  getAiQuotaStatus,
  grantLevelUpAiBonus,
};
