const express = require("express");
const db = require("../db/database");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const VALID_BREEDS = ["golden", "shiba", "siberian", "thairidgeback"];
const MAX_PET_NAME_LENGTH = 30;

const STATS = ["hunger", "cleanliness", "happiness", "energy"];

const DECAY_MINUTES_PER_POINT = {
  hunger: 1,
  happiness: 1.5,
  cleanliness: 2,
  energy: 3,
};

const STAT_TIMESTAMP_COLUMN = {
  hunger: "hunger_updated_at",
  cleanliness: "cleanliness_updated_at",
  happiness: "happiness_updated_at",
  energy: "energy_updated_at",
};

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

function toSqliteDatetime(ms) {
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

async function applyDecay(pet) {
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

  await db.prepare(`UPDATE pets SET ${setClauses.join(", ")} WHERE user_id = ?`).run(...values, pet.user_id);

  return { ...updated, ...timestampUpdates };
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

// ---------- GET /api/pet ----------
router.get("/", requireAuth, async (req, res, next) => {
  try {
    let pet = await db.prepare("SELECT * FROM pets WHERE user_id = ?").get(req.user.id);
    if (!pet) return res.json({ pet: null });

    pet = await applyDecay(pet);
    return res.json({ pet: serializePet(pet) });
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

// ---------- POST /api/pet/action ----------
router.post("/action", requireAuth, async (req, res) => {
  try {
    const { type } = req.body;
    const stat = ACTION_STAT[type];
    if (!stat) {
      return res.status(400).json({ message: "ประเภทกิจกรรมไม่ถูกต้อง" });
    }

    const petCount = Math.max(1, Math.min(10, Number(req.body.petCount) || 1));

    const requestedAmount = Number(req.body.amount);
    const amount = Number.isFinite(requestedAmount) ? Math.max(1, Math.min(30, Math.round(requestedAmount))) : null;

    let pet = await db.prepare("SELECT * FROM pets WHERE user_id = ?").get(req.user.id);
    if (!pet) {
      return res.status(404).json({ message: "ยังไม่มีสัตว์เลี้ยง กรุณาเลือกพันธุ์ก่อน" });
    }

    pet = await applyDecay(pet);

    const before = pet[stat];
    const gainPerUnit = amount ?? ACTION_GAIN[type];
    const totalGain = type === "happiness" ? gainPerUnit * petCount : gainPerUnit;
    const after = Math.min(100, before + totalGain);
    const actualGain = after - before;

    let carePoints = pet.care_points;
    let levelProgress = pet.level_progress;
    if (actualGain > 0 && carePoints < MAX_LEVEL) {
      levelProgress += actualGain;
      while (levelProgress >= LEVEL_XP_TARGET && carePoints < MAX_LEVEL) {
        levelProgress -= LEVEL_XP_TARGET;
        carePoints += 1;
      }
      if (carePoints >= MAX_LEVEL) {
        carePoints = MAX_LEVEL;
        levelProgress = 0;
      }
    }
    const leveledUp = carePoints !== pet.care_points;

    await db.prepare(
      `UPDATE pets SET ${stat} = ?, ${STAT_TIMESTAMP_COLUMN[stat]} = datetime('now'), care_points = ?, level_progress = ?
       WHERE user_id = ?`
    ).run(after, carePoints, levelProgress, req.user.id);

    const updatedPet = { ...pet, [stat]: after, care_points: carePoints, level_progress: levelProgress };

    return res.json({
      message: leveledUp ? `🎉 ${pet.name} เลเวลอัพเป็นเลเวล ${carePoints} แล้ว!` : "ทำกิจกรรมสำเร็จ",
      pet: serializePet(updatedPet),
      leveledUp,
      statGained: stat,
      amountGained: actualGain,
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

    const stat = ACTION_STAT[product.pet_action];
    const before = pet[stat];
    const after = Math.min(100, before + product.stat_gain);
    const actualGain = after - before;

    if (actualGain <= 0) {
      return res.status(400).json({
        message: `${STAT_FULL_LABEL[stat]}ของ${pet.name}เต็มอยู่แล้ว เก็บ${product.name}ไว้ใช้ทีหลังดีกว่านะ`,
      });
    }

    let carePoints = pet.care_points;
    let levelProgress = pet.level_progress;
    if (carePoints < MAX_LEVEL) {
      levelProgress += actualGain;
      while (levelProgress >= LEVEL_XP_TARGET && carePoints < MAX_LEVEL) {
        levelProgress -= LEVEL_XP_TARGET;
        carePoints += 1;
      }
      if (carePoints >= MAX_LEVEL) {
        carePoints = MAX_LEVEL;
        levelProgress = 0;
      }
    }
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
      await t.prepare(
        `UPDATE pets SET ${stat} = ?, ${STAT_TIMESTAMP_COLUMN[stat]} = datetime('now'), care_points = ?, level_progress = ?
         WHERE user_id = ?`
      ).run(after, carePoints, levelProgress, req.user.id);
    });

    const remaining = await db
      .prepare("SELECT count FROM inventory WHERE user_id = ? AND product_id = ?")
      .get(req.user.id, productId);

    const updatedPet = { ...pet, [stat]: after, care_points: carePoints, level_progress: levelProgress };

    return res.json({
      message: leveledUp ? `🎉 ${pet.name} เลเวลอัพเป็นเลเวล ${carePoints} แล้ว!` : `ใช้${product.name}กับ${pet.name}แล้ว`,
      pet: serializePet(updatedPet),
      leveledUp,
      statGained: stat,
      amountGained: actualGain,
      itemUsed: { id: product.id, name: product.name },
      remainingCount: remaining ? remaining.count : 0,
    });
  } catch (err) {
    console.error("Use pet item error:", err);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์" });
  }
});

module.exports = router;
