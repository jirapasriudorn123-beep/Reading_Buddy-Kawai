const db = require("../db/database");

// ================== กติกาเวลาอ่าน → คอยน์ ==================
// ปกติ: รอบอ่านแบบ Pomodoro อ่าน 25 นาที พัก 5 นาที ได้ 10 คอยน์ทุก 5 นาทีที่อ่านจริง
//       คอยน์จากเวลาอ่านได้วันละไม่เกิน 4 รอบ อ่านเกินได้แต่ไม่ได้คอยน์
// โหมดสาธิต (แอดมินเปิด/ปิดได้ที่หน้าแอดมิน): อ่าน 1 นาที พัก 1 นาที ได้ 10 คอยน์ทุก 1 นาที ไม่จำกัดรอบต่อวัน
//       และทำแบบทดสอบหลังอ่านได้หลังอ่านบทนั้นครบ 1 นาที — สาธิตครบวงจรได้ในไม่กี่นาที
const NORMAL_RULES = {
  demoMode: false,
  presets: [
    { id: "25", readMinutes: 25, breakMinutes: 5 },
  ],
  minutesPerBlock: 5,
  coinsPerBlock: 10,
  roundMinutes: 25,
  dailyCoinRounds: 4,
  postTestMinReadMinutes: null, // null = ใช้ค่าที่แอดมินตั้งรายบท (chapters.game_required_minutes)
};
const DEMO_RULES = {
  demoMode: true,
  presets: [
    { id: "demo1", readMinutes: 1, breakMinutes: 1 },
  ],
  minutesPerBlock: 1,
  coinsPerBlock: 10,
  roundMinutes: 1,
  dailyCoinRounds: null, // ไม่จำกัด
  postTestMinReadMinutes: 1,
};

const DEMO_MODE_KEY = "demo_mode";

async function getReadingRules() {
  const row = await db.prepare("SELECT value FROM site_meta WHERE key = ?").get(DEMO_MODE_KEY);
  return row && row.value === "1" ? DEMO_RULES : NORMAL_RULES;
}

async function setDemoMode(enabled) {
  await db
    .prepare(
      `INSERT INTO site_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(DEMO_MODE_KEY, enabled ? "1" : "0");
  return getReadingRules();
}

// คอยน์จากเวลาอ่านสูงสุดต่อวัน (null = ไม่จำกัด) — 4 รอบ × 25 นาที × (10 คอยน์ / 5 นาที) = 200
function dailyTimeCoinCap(rules) {
  if (!rules.dailyCoinRounds) return null;
  return rules.dailyCoinRounds * (rules.roundMinutes / rules.minutesPerBlock) * rules.coinsPerBlock;
}

// คอยน์ต่อ 1 รอบ (25 นาที) ใช้แปลงคอยน์ที่ได้วันนี้กลับเป็นจำนวนรอบให้ผู้ใช้เห็น
function coinsPerRound(rules) {
  return (rules.roundMinutes / rules.minutesPerBlock) * rules.coinsPerBlock;
}

// คอยน์จากเวลาอ่านที่ได้ไปแล้ววันนี้ (เวลาไทย นับตามวันที่จบรอบ รวมที่ยังรอปลดล็อก)
async function timeCoinsToday(userId) {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(coins_earned), 0) AS c FROM reading_sessions
       WHERE user_id = ? AND status = 'completed'
         AND date(ended_at, '+7 hours') = date('now', '+7 hours')`
    )
    .get(userId);
  return row.c || 0;
}

module.exports = { NORMAL_RULES, getReadingRules, setDemoMode, dailyTimeCoinCap, coinsPerRound, timeCoinsToday };
