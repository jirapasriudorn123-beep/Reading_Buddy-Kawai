const db = require("../db/database");
const { applyDecay } = require("./petCare");

// ================== น้องหมาหลายตัว: ซื้อตัวใหม่ + สลับตัว ==================
// ตัวที่เลือกอยู่ = แถวใน pets (1 แถวต่อคน ทุกส่วนของระบบอ่านจากตารางนี้เหมือนเดิม)
// ตัวอื่นอยู่ใน pet_stable — ค่าสถานะหยุดไว้ระหว่างอยู่ในคอก สลับกลับมาแล้วเริ่มนับลดใหม่จากตอนนั้น
// พันธุ์ละ 1 ตัวต่อคน (มีรูปและท่าทางแค่ 4 พันธุ์)

const VALID_BREEDS = ["golden", "shiba", "siberian", "thairidgeback"];
const MAX_PET_NAME_LENGTH = 30;

// แอดมินเปิด/ปิดการขายน้องหมาตัวใหม่ได้ (เช่น ปิดไว้ระหว่างเก็บข้อมูลวิจัย) — ยังไม่เคยตั้ง = เปิดขาย
const DOG_SALE_KEY = "dog_sale_enabled";

async function isDogSaleEnabled(conn = db) {
  const row = await conn.prepare("SELECT value FROM site_meta WHERE key = ?").get(DOG_SALE_KEY);
  return !row || row.value !== "0";
}

async function setDogSaleEnabled(enabled) {
  await db
    .prepare(
      `INSERT INTO site_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(DOG_SALE_KEY, enabled ? "1" : "0");
  return isDogSaleEnabled();
}

// พันธุ์ที่ผู้ใช้มีแล้ว (ตัวที่เลือกอยู่ + ตัวในคอก)
async function ownedBreeds(userId, conn = db) {
  const rows = await conn
    .prepare(
      `SELECT breed FROM pets WHERE user_id = ?
       UNION SELECT breed FROM pet_stable WHERE user_id = ?`
    )
    .all(userId, userId);
  return rows.map((r) => r.breed);
}

function validatePetName(name) {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) return { error: "อย่าลืมตั้งชื่อให้น้องด้วยนะ" };
  if (trimmed.length > MAX_PET_NAME_LENGTH) return { error: `ชื่อน้องต้องยาวไม่เกิน ${MAX_PET_NAME_LENGTH} ตัวอักษร` };
  return { name: trimmed };
}

// รับน้องหมาตัวใหม่เข้าคอก (เรียกใน transaction ตอนซื้อ) — ค่าสถานะเต็ม เลเวล 1
async function addToStable(conn, userId, breed, name) {
  await conn
    .prepare("INSERT INTO pet_stable (user_id, breed, name) VALUES (?, ?, ?)")
    .run(userId, breed, name);
}

function serializeStablePet(row) {
  return {
    id: row.id,
    breed: row.breed,
    name: row.name,
    level: row.care_points,
    hunger: row.hunger,
    cleanliness: row.cleanliness,
    happiness: row.happiness,
    energy: row.energy,
  };
}

async function listStable(userId) {
  const rows = await db
    .prepare("SELECT * FROM pet_stable WHERE user_id = ? ORDER BY created_at, id")
    .all(userId);
  return rows.map(serializeStablePet);
}

const MOVED_COLUMNS = [
  "breed", "name", "hunger", "cleanliness", "happiness", "energy", "growth_stage", "care_points", "level_progress",
];

// สลับตัวที่เลือกอยู่ (pets) กับตัวในคอก (pet_stable.id) ใน transaction เดียว
// ตัวที่เลือกอยู่: ใช้ค่าหลังหักตามเวลาก่อนเก็บเข้าคอก | ตัวที่ออกจากคอก: เริ่มนับเวลาลดค่าใหม่จากตอนนี้
async function switchPet(userId, stableId) {
  let active = await db.prepare("SELECT * FROM pets WHERE user_id = ?").get(userId);
  if (!active) return { error: "ยังไม่มีสัตว์เลี้ยง กรุณาเลือกพันธุ์ก่อน", status: 404 };
  active = await applyDecay(active);

  let switched = null;
  await db.tx(async (t) => {
    const incoming = await t
      .prepare("SELECT * FROM pet_stable WHERE id = ? AND user_id = ?")
      .get(stableId, userId);
    if (!incoming) return;

    await t.prepare("DELETE FROM pet_stable WHERE id = ?").run(incoming.id);
    await t
      .prepare(
        `INSERT INTO pet_stable (user_id, ${MOVED_COLUMNS.join(", ")}, created_at, stored_at)
         VALUES (?, ${MOVED_COLUMNS.map(() => "?").join(", ")}, ?, datetime('now'))`
      )
      .run(userId, ...MOVED_COLUMNS.map((col) => active[col]), active.created_at);
    const update = await t
      .prepare(
        `UPDATE pets SET ${MOVED_COLUMNS.map((col) => `${col} = ?`).join(", ")}, created_at = ?,
           stats_updated_at = datetime('now'), hunger_updated_at = datetime('now'),
           cleanliness_updated_at = datetime('now'), happiness_updated_at = datetime('now'),
           energy_updated_at = datetime('now')
         WHERE user_id = ? AND breed = ?`
      )
      .run(...MOVED_COLUMNS.map((col) => incoming[col]), incoming.created_at, userId, active.breed);
    if (update.changes === 0) {
      const err = new Error("PET_BUSY");
      err.code = "PET_BUSY";
      throw err; // อีกแท็บสลับไปก่อนแล้ว → rollback ทั้งก้อน
    }
    switched = incoming;
  });

  if (!switched) return { error: "ไม่พบน้องหมาตัวนี้ในคอกของคุณ", status: 404 };
  return { pet: await db.prepare("SELECT * FROM pets WHERE user_id = ?").get(userId) };
}

module.exports = {
  VALID_BREEDS,
  MAX_PET_NAME_LENGTH,
  isDogSaleEnabled,
  setDogSaleEnabled,
  ownedBreeds,
  validatePetName,
  addToStable,
  listStable,
  switchPet,
};
