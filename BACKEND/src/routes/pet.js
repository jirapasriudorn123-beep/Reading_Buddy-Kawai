const express = require("express");
const db = require("../db/database");
const { requireAuth } = require("../middleware/auth");
const { grantLevelUpAiBonus } = require("../services/aiQuota");
const {
  STAT_TIMESTAMP_COLUMN,
  LONELY_HAPPINESS_CAP,
  applyDecay,
  getReadingStreak,
} = require("../services/petCare");
const { VALID_BREEDS, MAX_PET_NAME_LENGTH, listStable, switchPet } = require("../services/petStable");

const router = express.Router();

const ACTION_STAT = {
  feed: "hunger",
  bath: "cleanliness",
  happiness: "happiness",
  sleep: "energy",
};

const STAT_FULL_LABEL = {
  hunger: "ความอิ่ม",
  cleanliness: "ความสะอาด",
  happiness: "ความสุข",
  energy: "พลังงาน",
};

const ACTION_GAIN = {
  feed: 15,
  bath: 15,
  happiness: 1,
  sleep: 20,
};

const MAX_LEVEL = 50;
const LEVEL_XP_TARGET = 250;

// ลูบหัว (ฟรี) ได้ XP แค่ครึ่งหนึ่งของความสุขที่เพิ่ม ส่วนไอเท็ม (ซื้อด้วยคอยน์จากการอ่าน) ได้ XP เต็ม
// เลเวลอัพยังได้เครดิตถาม AI เหมือนเดิม แต่จะได้มาจากการอ่าน (คอยน์ → ไอเท็ม) มากกว่าการลูบหัวอย่างเดียว
const PET_XP_RATIO = 0.5;

function addXp(carePoints, levelProgress, xp) {
  if (xp <= 0 || carePoints >= MAX_LEVEL) return { carePoints, levelProgress };
  levelProgress += xp;
  while (levelProgress >= LEVEL_XP_TARGET && carePoints < MAX_LEVEL) {
    levelProgress -= LEVEL_XP_TARGET;
    carePoints += 1;
  }
  if (carePoints >= MAX_LEVEL) return { carePoints: MAX_LEVEL, levelProgress: 0 };
  return { carePoints, levelProgress };
}

// XP จากการลูบหัวครั้งนี้ — คิดจากความสุขที่ลูบหัวได้สะสมทั้งหมด จะได้ไม่ปัดเศษทิ้ง (ลูบทีละ 1 ก็ได้ XP ทุก 2 ครั้ง)
async function pettingXp(userId, happinessGain) {
  if (happinessGain <= 0) return 0;
  const row = await db
    .prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM pet_action_log WHERE user_id = ? AND action = 'pet'")
    .get(userId);
  const before = row.total || 0;
  return Math.floor((before + happinessGain) * PET_XP_RATIO) - Math.floor(before * PET_XP_RATIO);
}

function serializePet(pet) {
  return {
    breed: pet.breed,
    name: pet.name,
    hunger: pet.hunger,
    cleanliness: pet.cleanliness,
    happiness: pet.happiness,
    energy: pet.energy,
    level: pet.care_points,
    levelProgress: pet.level_progress ?? 0,
    levelXpTarget: LEVEL_XP_TARGET,
  };
}

// ความสุขสูงสุดที่ลูบหัว/ของเล่นเติมให้ได้ตอนนี้ — ไม่ได้อ่านหลายวัน (เหงา) เติมได้ไม่เกินครึ่ง แต่ไม่ลดของที่มีอยู่
function happinessLimit(streak, current) {
  return streak.lonely ? Math.max(current, LONELY_HAPPINESS_CAP) : 100;
}

function lonelyMessage(petName, streak) {
  return `${petName}ยังเหงาอยู่ เพราะไม่ได้อ่านหนังสือด้วยกันมา ${streak.daysSinceRead} วันแล้ว 🥺 ` +
    `ลูบหัว/ของเล่นช่วยได้ไม่เกิน ${LONELY_HAPPINESS_CAP}% ไปอ่านหนังสือด้วยกันน้องจะหายเหงานะ`;
}

// ---------- GET /api/pet ----------
// คืนสถานะน้องหมา + streak การอ่าน (อ่านติดกันกี่วัน / ไม่ได้อ่านมากี่วัน / อารมณ์น้อง)
router.get("/", requireAuth, async (req, res, next) => {
  try {
    let pet = await db.prepare("SELECT * FROM pets WHERE user_id = ?").get(req.user.id);
    if (!pet) return res.json({ pet: null });

    pet = await applyDecay(pet);
    const streak = await getReadingStreak(req.user.id);
    return res.json({ pet: serializePet(pet), streak });
  } catch (err) {
    next(err);
  }
});

// ---------- POST /api/pet ----------
router.post("/", requireAuth, async (req, res) => {
  try {
    const { breed, name } = req.body;

    if (!breed || typeof breed !== "string") {
      return res.status(400).json({ message: "กรุณาเลือกพันธุ์สุนัขก่อนนะครับ" });
    }
    if (!VALID_BREEDS.includes(breed)) {
      return res.status(400).json({ message: "พันธุ์สุนัขที่เลือกไม่ถูกต้อง" });
    }
    if (!name || !name.trim()) {
      return res.status(400).json({ message: "อย่าลืมตั้งชื่อให้น้องด้วยนะ" });
    }
    if (name.trim().length > MAX_PET_NAME_LENGTH) {
      return res.status(400).json({ message: `ชื่อน้องต้องยาวไม่เกิน ${MAX_PET_NAME_LENGTH} ตัวอักษร` });
    }

    const existing = await db.prepare("SELECT user_id FROM pets WHERE user_id = ?").get(req.user.id);
    if (existing) {
      return res.status(409).json({ message: "คุณมีสัตว์เลี้ยงอยู่แล้ว ไม่สามารถเลือกใหม่ได้" });
    }

    await db.prepare(
      `INSERT INTO pets (
         user_id, breed, name, hunger, cleanliness, happiness, energy, growth_stage, care_points,
         stats_updated_at, hunger_updated_at, cleanliness_updated_at, happiness_updated_at, energy_updated_at
       )
       VALUES (?, ?, ?, 100, 100, 100, 100, 'baby', 1, datetime('now'), datetime('now'), datetime('now'), datetime('now'), datetime('now'))`
    ).run(req.user.id, breed, name.trim());

    return res.status(201).json({
      message: "สร้างสัตว์เลี้ยงสำเร็จ",
      pet: {
        breed,
        name: name.trim(),
        hunger: 100,
        cleanliness: 100,
        happiness: 100,
        energy: 100,
        level: 1,
        levelProgress: 0,
        levelXpTarget: LEVEL_XP_TARGET,
      },
    });
  } catch (err) {
    console.error("Create pet error:", err);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์" });
  }
});

// ข้อมูลวิจัย: บันทึกการดูแลน้องหมา (ดู pet_action_log ใน database.js) — บันทึกไม่สำเร็จก็ไม่ให้กระทบการใช้งาน
// breed = ดูแลตัวไหน (มีได้หลายตัว ตัวละพันธุ์)
async function logPetAction(conn, userId, action, isFree, productId, amount, breed) {
  await conn
    .prepare("INSERT INTO pet_action_log (user_id, action, is_free, product_id, amount, breed) VALUES (?, ?, ?, ?, ?, ?)")
    .run(userId, action, isFree ? 1 : 0, productId || null, amount || 0, breed || null);
}

// ---------- POST /api/pet/visit ----------
// หน้าน้องหมาเรียกตอนเปิดหน้า: นับการเข้าไปหาน้องหมา (ครั้งเดียวต่อ 30 นาที รีเฟรชซ้ำไม่นับเพิ่ม)
const VISIT_DEDUPE_MINUTES = 30;
router.post("/visit", requireAuth, async (req, res, next) => {
  try {
    const recent = await db
      .prepare(
        `SELECT 1 FROM pet_action_log WHERE user_id = ? AND action = 'visit'
         AND created_at > datetime('now', ?) LIMIT 1`
      )
      .get(req.user.id, `-${VISIT_DEDUPE_MINUTES} minutes`);
    if (!recent) {
      const pet = await db.prepare("SELECT breed FROM pets WHERE user_id = ?").get(req.user.id);
      await logPetAction(db, req.user.id, "visit", true, null, 0, pet && pet.breed);
    }
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/pet/all ----------
// น้องหมาทุกตัวของผู้ใช้: ตัวที่เลือกอยู่ + ตัวในคอก (ใช้ในหน้าน้องหมา "น้องหมาของฉัน")
router.get("/all", requireAuth, async (req, res, next) => {
  try {
    let pet = await db.prepare("SELECT * FROM pets WHERE user_id = ?").get(req.user.id);
    if (!pet) return res.json({ active: null, others: [] });
    pet = await applyDecay(pet);
    return res.json({ active: serializePet(pet), others: await listStable(req.user.id) });
  } catch (err) {
    next(err);
  }
});

// ---------- POST /api/pet/switch ----------
// เลือกน้องหมาตัวในคอก (stableId) มาเป็นตัวที่เลี้ยงอยู่ ตัวเดิมเข้าคอกแทน
router.post("/switch", requireAuth, async (req, res, next) => {
  try {
    const stableId = Number(req.body.stableId);
    if (!Number.isInteger(stableId) || stableId <= 0) {
      return res.status(400).json({ message: "ไม่ได้ระบุน้องหมาที่จะเลือก" });
    }
    const result = await switchPet(req.user.id, stableId);
    if (result.error) return res.status(result.status).json({ message: result.error });
    const streak = await getReadingStreak(req.user.id);
    return res.json({
      message: `เปลี่ยนมาเลี้ยง${result.pet.name}แล้ว`,
      pet: serializePet(result.pet),
      streak,
      others: await listStable(req.user.id),
    });
  } catch (err) {
    if (err.code === "PET_BUSY") {
      return res.status(409).json({ message: "กำลังสลับน้องหมาอยู่ ลองใหม่อีกครั้งนะ" });
    }
    next(err);
  }
});

function levelUpMessage(petName, level, aiBonusGained) {
  const bonus = aiBonusGained > 0 ? `\n🤖 ได้คำถาม AI ฟรีเพิ่ม +${aiBonusGained} ข้อ` : "";
  return `🎉 ${petName} เลเวลอัพเป็นเลเวล ${level} แล้ว!${bonus}`;
}

// ---------- POST /api/pet/action ----------
router.post("/action", requireAuth, async (req, res) => {
  try {
    const { type } = req.body;
    // กิจกรรมฟรีมีแค่ลูบหัว/เล่น (happiness) — ให้อาหาร/อาบน้ำ/นอน ต้องใช้ไอเท็มที่ซื้อผ่าน /use-item เท่านั้น
    // (เดิมรับทุก type + ให้กำหนด amount เองได้ ยิง API ตรงๆ ก็เติมค่า/ปั๊มเลเวลฟรีได้ไม่จำกัด)
    if (type !== "happiness") {
      return res.status(400).json({ message: "ประเภทกิจกรรมไม่ถูกต้อง" });
    }
    const stat = ACTION_STAT[type];

    const petCount = Math.max(1, Math.min(10, Number(req.body.petCount) || 1));

    let pet = await db.prepare("SELECT * FROM pets WHERE user_id = ?").get(req.user.id);
    if (!pet) {
      return res.status(404).json({ message: "ยังไม่มีสัตว์เลี้ยง กรุณาเลือกพันธุ์ก่อน" });
    }

    pet = await applyDecay(pet);
    const streak = await getReadingStreak(req.user.id);

    const before = pet[stat];
    const totalGain = ACTION_GAIN[type] * petCount;
    const after = Math.min(happinessLimit(streak, before), before + totalGain);
    const actualGain = Math.max(0, after - before);
    const cappedByLoneliness = streak.lonely && before + totalGain > after && after < 100;

    const xpGained = await pettingXp(req.user.id, actualGain);
    const { carePoints, levelProgress } = addXp(pet.care_points, pet.level_progress, xpGained);
    const leveledUp = carePoints !== pet.care_points;

    // guard ด้วยค่าเลเวลเดิม: ยิงพร้อมกันหลาย request ตอนใกล้เลเวลอัพ จะได้ไม่เลเวลอัพ (และได้โบนัส AI) ซ้ำ
    const update = await db.prepare(
      `UPDATE pets SET ${stat} = ?, ${STAT_TIMESTAMP_COLUMN[stat]} = datetime('now'), care_points = ?, level_progress = ?
       WHERE user_id = ? AND care_points = ? AND level_progress = ?`
    ).run(after, carePoints, levelProgress, req.user.id, pet.care_points, pet.level_progress);
    if (update.changes === 0) {
      return res.status(409).json({ message: "น้องหมากำลังยุ่งอยู่ ลองใหม่อีกครั้งนะ" });
    }
    await logPetAction(db, req.user.id, "pet", true, null, actualGain, pet.breed).catch((err) =>
      console.error("Log pet action error:", err)
    );

    const aiBonusGained = await grantLevelUpAiBonus(req.user.id, carePoints - pet.care_points);
    const updatedPet = { ...pet, [stat]: after, care_points: carePoints, level_progress: levelProgress };

    return res.json({
      message: leveledUp
        ? levelUpMessage(pet.name, carePoints, aiBonusGained)
        : cappedByLoneliness
        ? lonelyMessage(pet.name, streak)
        : "ทำกิจกรรมสำเร็จ",
      lonely: streak.lonely,
      lonelyCapped: cappedByLoneliness,
      pet: serializePet(updatedPet),
      leveledUp,
      aiBonusGained,
      statGained: stat,
      amountGained: actualGain,
      xpGained: pet.care_points >= MAX_LEVEL ? 0 : xpGained,
    });
  } catch (err) {
    console.error("Pet action error:", err);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์" });
  }
});

// ---------- POST /api/pet/use-item ----------
router.post("/use-item", requireAuth, async (req, res) => {
  try {
    const { productId } = req.body;
    if (!productId) {
      return res.status(400).json({ message: "ไม่ได้ระบุไอเทมที่จะใช้" });
    }

    const product = await db
      .prepare("SELECT id, name, img, pet_action, stat_gain FROM products WHERE id = ?")
      .get(productId);
    if (!product) {
      return res.status(404).json({ message: "ไม่พบไอเทมนี้" });
    }
    if (!product.pet_action || !ACTION_STAT[product.pet_action]) {
      return res.status(400).json({ message: `${product.name} เป็นของสะสม ใช้กับน้องหมาไม่ได้` });
    }

    const owned = await db
      .prepare("SELECT count FROM inventory WHERE user_id = ? AND product_id = ?")
      .get(req.user.id, productId);
    if (!owned || owned.count <= 0) {
      return res.status(400).json({ message: `คุณไม่มี${product.name}ในกระเป๋าแล้ว ไปซื้อเพิ่มที่ร้านค้าได้เลย` });
    }

    let pet = await db.prepare("SELECT * FROM pets WHERE user_id = ?").get(req.user.id);
    if (!pet) {
      return res.status(404).json({ message: "ยังไม่มีสัตว์เลี้ยง กรุณาเลือกพันธุ์ก่อน" });
    }

    pet = await applyDecay(pet);
    const streak = await getReadingStreak(req.user.id);

    const stat = ACTION_STAT[product.pet_action];
    const before = pet[stat];
    const limit = stat === "happiness" ? happinessLimit(streak, before) : 100;
    const after = Math.min(limit, before + product.stat_gain);
    const actualGain = after - before;

    // เหงาอยู่: ของเล่นเติมความสุขได้แค่ครึ่งเดียว (ไม่เสียไอเทม)
    if (actualGain <= 0 && limit < 100) {
      return res.status(400).json({ message: lonelyMessage(pet.name, streak), lonely: true });
    }
    if (actualGain <= 0) {
      return res.status(400).json({
        message: `${STAT_FULL_LABEL[stat]}ของ${pet.name}เต็มอยู่แล้ว เก็บ${product.name}ไว้ใช้ทีหลังดีกว่านะ`,
      });
    }

    const { carePoints, levelProgress } = addXp(pet.care_points, pet.level_progress, actualGain);
    const leveledUp = carePoints !== pet.care_points;

    await db.tx(async (t) => {
      await t.prepare("UPDATE inventory SET count = count - 1 WHERE user_id = ? AND product_id = ?").run(
        req.user.id,
        productId
      );
      await t.prepare("DELETE FROM inventory WHERE user_id = ? AND product_id = ? AND count <= 0").run(
        req.user.id,
        productId
      );
      const update = await t.prepare(
        `UPDATE pets SET ${stat} = ?, ${STAT_TIMESTAMP_COLUMN[stat]} = datetime('now'), care_points = ?, level_progress = ?
         WHERE user_id = ? AND care_points = ? AND level_progress = ?`
      ).run(after, carePoints, levelProgress, req.user.id, pet.care_points, pet.level_progress);
      if (update.changes === 0) {
        const err = new Error("PET_BUSY");
        err.code = "PET_BUSY";
        throw err; // rollback ทั้งก้อน ไอเท็มไม่หาย
      }
      await logPetAction(t, req.user.id, product.pet_action, false, product.id, actualGain, pet.breed);
    });
    const aiBonusGained = await grantLevelUpAiBonus(req.user.id, carePoints - pet.care_points);

    const remaining = await db
      .prepare("SELECT count FROM inventory WHERE user_id = ? AND product_id = ?")
      .get(req.user.id, productId);

    const updatedPet = { ...pet, [stat]: after, care_points: carePoints, level_progress: levelProgress };

    return res.json({
      message: leveledUp ? levelUpMessage(pet.name, carePoints, aiBonusGained) : `ใช้${product.name}กับ${pet.name}แล้ว`,
      pet: serializePet(updatedPet),
      leveledUp,
      aiBonusGained,
      statGained: stat,
      amountGained: actualGain,
      xpGained: pet.care_points >= MAX_LEVEL ? 0 : actualGain,
      itemUsed: { id: product.id, name: product.name },
      remainingCount: remaining ? remaining.count : 0,
    });
  } catch (err) {
    if (err.code === "PET_BUSY") {
      return res.status(409).json({ message: "น้องหมากำลังยุ่งอยู่ ลองใหม่อีกครั้งนะ" });
    }
    console.error("Use pet item error:", err);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์" });
  }
});

module.exports = router;
