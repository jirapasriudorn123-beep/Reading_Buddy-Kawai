const express = require("express");
const db = require("../db/database");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const VALID_BREEDS = ["golden", "shiba", "siberian", "thairidgeback"]; // ต้องตรงกับพันธุ์ในหน้า select-pet.html

// ---------- ระบบสถานะ 4 อย่าง (0-100) ที่ลดลงเองตามเวลาจริง ----------
// แต่ละสถานะลดเร็วช้าไม่เท่ากันตามความเร่งด่วนตามธรรมชาติ: หิวบ่อยสุด -> ความสุขต้องมีปฏิสัมพันธ์บ่อย -> สะอาดช้ากว่า -> พลังงานช้าสุด

const STATS = ["hunger", "cleanliness", "happiness", "energy"];

const DECAY_MINUTES_PER_POINT = {
  hunger: 1, // หิวเร็วที่สุด ต้องป้อนอาหารสม่ำเสมอ
  happiness: 1.5, // ต้องเล่นด้วย/ลูบหัวบ่อยๆ ไม่งั้นเหงา
  cleanliness: 2, // สกปรกช้ากว่าหิว
  energy: 3, // นอนไม่ต้องบ่อยเท่าอย่างอื่น ลดช้าสุด
};

// แต่ละสถานะมี timestamp ของตัวเอง (ไม่ใช้ตัวเดียวร่วมกัน) เพราะถ้าสถานะที่ลดเร็วรีเซ็ตนาฬิกาบ่อยๆ
// จะไปตัดรอบสะสมเวลาของสถานะที่ลดช้ากว่า ทำให้สถานะนั้นแทบไม่ลดเลย
const STAT_TIMESTAMP_COLUMN = {
  hunger: "hunger_updated_at",
  cleanliness: "cleanliness_updated_at",
  happiness: "happiness_updated_at",
  energy: "energy_updated_at",
};

// action ที่กดจากปุ่ม/กระเป๋าไอเทม -> สถานะที่จะเพิ่มขึ้น + แต้มที่ได้ต่อครั้ง (ไม่อิงไอเทมที่เลือกเพื่อความง่าย)
const ACTION_STAT = {
  feed: "hunger",
  bath: "cleanliness",
  happiness: "happiness", // ปุ่ม "เล่นและลูบหัว" เดิมรวม pat+play เข้าด้วยกัน
  sleep: "energy",
};
// ชื่อสถานะภาษาไทย ใช้ตอนบอกผู้ใช้ว่าสถานะนั้นเต็มแล้ว ไม่ต้องเปลืองไอเทม
const STAT_FULL_LABEL = {
  hunger: "ความอิ่ม",
  cleanliness: "ความสะอาด",
  happiness: "ความสุข",
  energy: "พลังงาน",
};

const ACTION_GAIN = {
  feed: 15,
  bath: 15,
  happiness: 1, // ต่อการลูบ 1 ครั้ง (คลิกค้างลูบหัวจะยิงมาหลายครั้งต่อ 1 request ผ่าน petCount)
  sleep: 20,
};

// ระบบเลเวล: สะสม level_progress ตามเปอร์เซ็นต์สถานะที่ขึ้นจริงจากแต่ละครั้ง (ไม่ใช่ +1 ตายตัวเหมือนเดิม)
// พอสะสมครบ LEVEL_XP_TARGET ค่อยเลื่อนเลเวล ทำให้ของแรงช่วยเลื่อนเลเวลเร็วกว่าของอ่อนจริงๆ และอัพยากขึ้นกว่าเดิมมาก
// (เดิม 1 ครั้งที่สถานะขึ้น = 1 เลเวลทันที ไม่ว่าไอเทมจะแรงแค่ไหน)
const MAX_LEVEL = 50;
const LEVEL_XP_TARGET = 250;

// แปลง ms (UTC) เป็นรูปแบบ datetime ของ sqlite ("YYYY-MM-DD HH:MM:SS") ให้ตรงกับที่ datetime('now') ใช้
function toSqliteDatetime(ms) {
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

// คำนวณสถานะที่ลดลงจริงตามเวลาที่ผ่านไป แยกคำนวณต่อสถานะ (คนละอัตรา คนละนาฬิกา)
// เดินหน้า timestamp ไปตามจำนวนแต้มที่ลดจริงเท่านั้น (ไม่ตั้งเป็น "เดี๋ยวนี้" ตรงๆ) เพื่อไม่ทิ้งเศษเวลาที่ยังสะสมไม่ครบ 1 แต้ม
function applyDecay(pet) {
  const now = Date.now();
  const updated = { ...pet };
  const timestampUpdates = {};

  for (const stat of STATS) {
    const col = STAT_TIMESTAMP_COLUMN[stat];
    const lastMs = new Date(pet[col] + "Z").getTime(); // datetime('now') ของ sqlite เป็น UTC
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

  db.prepare(`UPDATE pets SET ${setClauses.join(", ")} WHERE user_id = ?`).run(...values, pet.user_id);

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
    levelProgress: pet.level_progress ?? 0, // 0 ถึง levelXpTarget-1 สะสมภายในเลเวลปัจจุบัน
    levelXpTarget: LEVEL_XP_TARGET,
  };
}

// ---------- GET /api/pet ----------
// ดึงข้อมูลสัตว์เลี้ยงของผู้ใช้ปัจจุบัน (คืน null ถ้ายังไม่เคยเลือก) พร้อมคำนวณสถานะที่ลดไปตามเวลาจริง
router.get("/", requireAuth, (req, res) => {
  let pet = db.prepare("SELECT * FROM pets WHERE user_id = ?").get(req.user.id);
  if (!pet) return res.json({ pet: null });

  pet = applyDecay(pet);
  return res.json({ pet: serializePet(pet) });
});

// ---------- POST /api/pet ----------
// เลือกพันธุ์ + ตั้งชื่อสัตว์เลี้ยง (ทำได้ครั้งแรกครั้งเดียว) เริ่มต้นทุกสถานะเต็ม 100 ที่ช่วงวัยทารก
router.post("/", requireAuth, (req, res) => {
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

    const existing = db.prepare("SELECT user_id FROM pets WHERE user_id = ?").get(req.user.id);
    if (existing) {
      return res.status(409).json({ message: "คุณมีสัตว์เลี้ยงอยู่แล้ว ไม่สามารถเลือกใหม่ได้" });
    }

    db.prepare(
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
// ทำกิจกรรมกับสัตว์เลี้ยง (feed/bath/happiness/sleep) เพิ่มสถานะที่เกี่ยวข้อง สะสมแต้มเลเวล
// body: { type, petCount?, amount? }
//   - petCount ใช้เฉพาะตอนคลิกค้างลูบหัว (ปกติ = 1 ครั้งต่อ request)
//   - amount ใช้เฉพาะตอนใช้ไอเทมจากกระเป๋า (ค่า % ที่ไอเทมนั้นให้จริงตามที่โชว์ในร้าน/กระเป๋า) ถ้าไม่ส่งมาจะ fallback เป็นค่ากิจกรรมพื้นฐาน
router.post("/action", requireAuth, (req, res) => {
  try {
    const { type } = req.body;
    const stat = ACTION_STAT[type];
    if (!stat) {
      return res.status(400).json({ message: "ประเภทกิจกรรมไม่ถูกต้อง" });
    }

    // กันโกงกรณีลูบหัวค้างไว้นานแล้วส่งจำนวนครั้งเวอร์ๆ มา จำกัดสูงสุด 10 ครั้งต่อ 1 request
    const petCount = Math.max(1, Math.min(10, Number(req.body.petCount) || 1));

    // กันโกงกรณีแก้ amount ที่ส่งมาให้เวอร์เกินจริง จำกัดไว้ในช่วงที่ไอเทมจริงเป็นไปได้ (ไอเทมแรงสุดในร้านตอนนี้ ~25%)
    const requestedAmount = Number(req.body.amount);
    const amount = Number.isFinite(requestedAmount) ? Math.max(1, Math.min(30, Math.round(requestedAmount))) : null;

    let pet = db.prepare("SELECT * FROM pets WHERE user_id = ?").get(req.user.id);
    if (!pet) {
      return res.status(404).json({ message: "ยังไม่มีสัตว์เลี้ยง กรุณาเลือกพันธุ์ก่อน" });
    }

    pet = applyDecay(pet);

    const before = pet[stat];
    const gainPerUnit = amount ?? ACTION_GAIN[type];
    const totalGain = type === "happiness" ? gainPerUnit * petCount : gainPerUnit;
    const after = Math.min(100, before + totalGain);
    const actualGain = after - before;

    // เลื่อนเลเวลตามเปอร์เซ็นต์สถานะที่ขึ้นจริง (ไอเทมแรงช่วยเลื่อนเลเวลเร็วกว่าไอเทมอ่อนจริงๆ) สะสมครบ LEVEL_XP_TARGET ถึงขึ้น 1 เลเวล
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
        levelProgress = 0; // เต็มเลเวลสูงสุดแล้ว ไม่ต้องสะสมต่อ
      }
    }
    const leveledUp = carePoints !== pet.care_points;

    // รีเซ็ตนาฬิกาลดของสถานะที่เพิ่งดูแลไปเท่านั้น (สถานะอื่นเดินนาฬิกาของตัวเองต่อไปตามปกติ)
    db.prepare(
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
// ใช้ไอเทมที่ซื้อไว้จริงในคลัง (ตาราง inventory) กับน้องหมา แล้วหักจำนวนออก 1 ชิ้น
// ต่างจาก /action ตรงที่ค่าที่เพิ่มมาจาก products.stat_gain ในฐานข้อมูลล้วนๆ ไม่รับตัวเลขจาก client เลย (กันโกง)
// body: { productId }
router.post("/use-item", requireAuth, (req, res) => {
  try {
    const { productId } = req.body;
    if (!productId) {
      return res.status(400).json({ message: "ไม่ได้ระบุไอเทมที่จะใช้" });
    }

    const product = db
      .prepare("SELECT id, name, img, pet_action, stat_gain FROM products WHERE id = ?")
      .get(productId);
    if (!product) {
      return res.status(404).json({ message: "ไม่พบไอเทมนี้" });
    }
    if (!product.pet_action || !ACTION_STAT[product.pet_action]) {
      return res.status(400).json({ message: `${product.name} เป็นของสะสม ใช้กับน้องหมาไม่ได้` });
    }

    const owned = db
      .prepare("SELECT count FROM inventory WHERE user_id = ? AND product_id = ?")
      .get(req.user.id, productId);
    if (!owned || owned.count <= 0) {
      return res.status(400).json({ message: `คุณไม่มี${product.name}ในกระเป๋าแล้ว ไปซื้อเพิ่มที่ร้านค้าได้เลย` });
    }

    let pet = db.prepare("SELECT * FROM pets WHERE user_id = ?").get(req.user.id);
    if (!pet) {
      return res.status(404).json({ message: "ยังไม่มีสัตว์เลี้ยง กรุณาเลือกพันธุ์ก่อน" });
    }

    pet = applyDecay(pet);

    const stat = ACTION_STAT[product.pet_action];
    const before = pet[stat];
    const after = Math.min(100, before + product.stat_gain);
    const actualGain = after - before;

    // สถานะเต็มอยู่แล้ว ไม่ต้องเปลืองไอเทม (ไม่หักของออกจากกระเป๋า)
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

    // หักไอเทมกับอัปเดตสถานะน้องต้องเกิดพร้อมกัน ไม่งั้นถ้าพังกลางทางจะได้ของฟรีหรือของหายเปล่าๆ
    const useTransaction = db.transaction(() => {
      db.prepare("UPDATE inventory SET count = count - 1 WHERE user_id = ? AND product_id = ?").run(
        req.user.id,
        productId
      );
      db.prepare("DELETE FROM inventory WHERE user_id = ? AND product_id = ? AND count <= 0").run(
        req.user.id,
        productId
      );
      db.prepare(
        `UPDATE pets SET ${stat} = ?, ${STAT_TIMESTAMP_COLUMN[stat]} = datetime('now'), care_points = ?, level_progress = ?
         WHERE user_id = ?`
      ).run(after, carePoints, levelProgress, req.user.id);
    });
    useTransaction();

    const remaining = db
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
