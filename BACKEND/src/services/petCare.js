const db = require("../db/database");
const { getReadingRules } = require("./readingRules");

// ================== ค่าสถานะน้องหมา + ความต่อเนื่องในการอ่าน (streak) ==================
// ค่าสถานะลดลงช้าๆ ระดับรายวัน (เดิมลดทุกนาที ความอิ่มหมดในไม่ถึง 2 ชม. น้องหมาเลยเศร้าเกือบตลอด)
// ความสุขผูกกับการอ่าน: อ่านจบรอบ = น้องดีใจ | ไม่ได้อ่านหลายวัน = น้องเหงา ลูบหัว/ของเล่นช่วยได้ไม่เกินครึ่ง
// น้องหมาไม่ตาย — แค่เหงา (ทฤษฎีความผูกพัน + loss aversion: ไม่อยากให้น้องเหงา เลยกลับมาอ่าน)

const STATS = ["hunger", "cleanliness", "happiness", "energy"];

// ลดวันละกี่จุด (จาก 100 จนหมด: อิ่ม 4 วัน, สุข 5 วัน, สะอาด ~7 วัน, พลังงาน 10 วัน)
const DECAY_POINTS_PER_DAY = {
  hunger: 25,
  happiness: 20,
  cleanliness: 15,
  energy: 10,
};
const DECAY_MINUTES_PER_POINT = Object.fromEntries(
  Object.entries(DECAY_POINTS_PER_DAY).map(([stat, perDay]) => [stat, (24 * 60) / perDay])
);

const STAT_TIMESTAMP_COLUMN = {
  hunger: "hunger_updated_at",
  cleanliness: "cleanliness_updated_at",
  happiness: "happiness_updated_at",
  energy: "energy_updated_at",
};

// วันที่นับว่า "อ่านแล้ว" = อ่านจบรอบรวมกันในวันนั้นอย่างน้อยเท่านี้ (โหมดสาธิต 1 นาที)
const STREAK_MIN_MINUTES = 10;
const STREAK_MIN_MINUTES_DEMO = 1;
// อ่านจบรอบ (ถึงเกณฑ์ข้างบน) → ความสุขน้องหมาเพิ่ม
const READING_HAPPINESS_BOOST = 25;
// ไม่ได้อ่านตั้งแต่ 2 วันขึ้นไป (เหงา) → ลูบหัว/ของเล่นเพิ่มความสุขได้ไม่เกินเท่านี้ ต้องอ่านด้วยกันถึงจะหายเหงา
const LONELY_HAPPINESS_CAP = 50;

function toSqliteDatetime(ms) {
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

async function applyDecay(pet, conn = db) {
  const now = Date.now();
  const updated = { ...pet };
  const timestampUpdates = {};

  for (const stat of STATS) {
    const col = STAT_TIMESTAMP_COLUMN[stat];
    const lastMs = new Date(pet[col] + "Z").getTime();
    const rateMinutes = DECAY_MINUTES_PER_POINT[stat];
    const elapsedMinutes = Math.max(0, (now - lastMs) / 60000);
    const decayPoints = Math.floor(elapsedMinutes / rateMinutes);

    if (decayPoints > 0) {
      updated[stat] = Math.max(0, pet[stat] - decayPoints);
      timestampUpdates[col] = toSqliteDatetime(lastMs + decayPoints * rateMinutes * 60000);
    }
  }

  if (Object.keys(timestampUpdates).length === 0) return pet;

  const setClauses = [...STATS.map((stat) => `${stat} = ?`), ...Object.keys(timestampUpdates).map((col) => `${col} = ?`)];
  const values = [...STATS.map((stat) => updated[stat]), ...Object.values(timestampUpdates)];

  await conn.prepare(`UPDATE pets SET ${setClauses.join(", ")} WHERE user_id = ?`).run(...values, pet.user_id);

  return { ...updated, ...timestampUpdates };
}

// ---------- streak ----------

function thaiToday() {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function dayDiff(fromDate, toDate) {
  return Math.round((Date.parse(toDate) - Date.parse(fromDate)) / 86400000);
}

async function streakMinSeconds() {
  const rules = await getReadingRules();
  return (rules.demoMode ? STREAK_MIN_MINUTES_DEMO : STREAK_MIN_MINUTES) * 60;
}

// อารมณ์น้องหมาตามจำนวนวันที่ไม่ได้อ่าน: happy (อ่านวันนี้แล้ว) | waiting (อ่านล่าสุดเมื่อวาน รอวันนี้)
// | lonely (2-3 วัน) | very_lonely (4 วันขึ้นไป) | new (ยังไม่เคยอ่าน)
function moodFor(daysSinceRead) {
  if (daysSinceRead === null) return "new";
  if (daysSinceRead === 0) return "happy";
  if (daysSinceRead === 1) return "waiting";
  if (daysSinceRead <= 3) return "lonely";
  return "very_lonely";
}

function isLonely(mood) {
  return mood === "lonely" || mood === "very_lonely";
}

// นับ streak จากวันที่อ่านถึงเกณฑ์ (วันไทย เรียงใหม่ → เก่า): ปัจจุบัน + ยาวที่สุด + อารมณ์น้องหมา
function streakFromDays(days, minSeconds) {
  const today = thaiToday();
  const daysSinceRead = days.length ? dayDiff(days[0], today) : null;
  // streak ยังไม่ขาดถ้าอ่านล่าสุดวันนี้หรือเมื่อวาน (วันนี้ยังอ่านทัน)
  let current = 0;
  if (daysSinceRead !== null && daysSinceRead <= 1) {
    current = 1;
    while (current < days.length && dayDiff(days[current], days[current - 1]) === 1) current += 1;
  }
  let longest = days.length ? 1 : 0;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    run = dayDiff(days[i], days[i - 1]) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }

  const mood = moodFor(daysSinceRead);
  return {
    current,
    longest,
    lastReadDate: days[0] || null,
    daysSinceRead,
    readToday: daysSinceRead === 0,
    mood,
    lonely: isLonely(mood),
    minMinutes: minSeconds / 60,
  };
}

const READING_DAYS_SQL = `SELECT user_id, date(started_at, '+7 hours') AS day FROM reading_sessions
  WHERE status = 'completed' {filter}
  GROUP BY user_id, day HAVING SUM(read_seconds) >= ?
  ORDER BY day DESC`;

async function getReadingStreak(userId) {
  const minSeconds = await streakMinSeconds();
  const rows = await db.prepare(READING_DAYS_SQL.replace("{filter}", "AND user_id = ?")).all(userId, minSeconds);
  return streakFromDays(rows.map((r) => r.day), minSeconds);
}

// streak ของผู้ใช้ทุกคนในคำสั่งเดียว (หน้าแอดมิน) คืน Map(userId → streak) — คนที่ไม่เคยอ่านไม่มีใน Map
async function getReadingStreaksForAll() {
  const minSeconds = await streakMinSeconds();
  const rows = await db.prepare(READING_DAYS_SQL.replace("{filter}", "")).all(minSeconds);
  const daysByUser = new Map();
  for (const r of rows) {
    if (!daysByUser.has(r.user_id)) daysByUser.set(r.user_id, []);
    daysByUser.get(r.user_id).push(r.day);
  }
  return new Map([...daysByUser].map(([userId, days]) => [userId, streakFromDays(days, minSeconds)]));
}

// อ่านจบรอบ: ถ้าเวลาที่อ่านรอบนี้ถึงเกณฑ์ ความสุขน้องหมา +25 (ไม่ได้ XP — XP มาจากการดูแลเท่านั้น)
// คืนจำนวนที่เพิ่มจริง (0 = ไม่มีหมา/อ่านไม่ถึงเกณฑ์/ความสุขเต็มแล้ว)
async function boostHappinessForReading(userId, readSeconds) {
  if (readSeconds < (await streakMinSeconds())) return 0;
  let pet = await db.prepare("SELECT * FROM pets WHERE user_id = ?").get(userId);
  if (!pet) return 0;
  pet = await applyDecay(pet);
  const after = Math.min(100, pet.happiness + READING_HAPPINESS_BOOST);
  const gained = after - pet.happiness;
  if (gained <= 0) return 0;
  await db
    .prepare("UPDATE pets SET happiness = ?, happiness_updated_at = datetime('now') WHERE user_id = ?")
    .run(after, userId);
  return gained;
}

module.exports = {
  STATS,
  STAT_TIMESTAMP_COLUMN,
  DECAY_POINTS_PER_DAY,
  LONELY_HAPPINESS_CAP,
  READING_HAPPINESS_BOOST,
  applyDecay,
  getReadingStreak,
  getReadingStreaksForAll,
  boostHappinessForReading,
};
