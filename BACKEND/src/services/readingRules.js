const db = require("../db/database");

// ================== กติกาเวลาอ่าน → คอยน์ ==================
// ปกติ: ตั้งเวลาอ่านขั้นต่ำ 10 นาที, ได้ 10 คอยน์ทุก 5 นาทีที่อ่านจริง (ตามที่กำหนดในเล่มวิจัย)
// โหมดสาธิต (แอดมินเปิด/ปิดได้ที่หน้าแอดมิน): ขั้นต่ำ 1 นาที, ได้ 10 คอยน์ทุก 1 นาที — สาธิตจับเวลาจนจบได้ในไม่กี่นาที
const NORMAL_RULES = { demoMode: false, minReadMinutes: 10, minutesPerBlock: 5, coinsPerBlock: 10 };
const DEMO_RULES = { demoMode: true, minReadMinutes: 1, minutesPerBlock: 1, coinsPerBlock: 10 };

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

module.exports = { NORMAL_RULES, getReadingRules, setDemoMode };
