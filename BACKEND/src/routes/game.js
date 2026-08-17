const express = require("express");
const db = require("../db/database");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// จำนวนเวิลด์ทั้งหมด และจำนวนด่านต่อเวิลด์ของ Phayao Adventure
// (ต้องตรงกับฝั่ง FRONTEND/stage-select.js)
const TOTAL_WORLDS = 6;
const STAGES_PER_WORLD = 4;

function getOrCreateProgress(userId) {
  let row = db.prepare("SELECT * FROM game_progress WHERE user_id = ?").get(userId);
  if (!row) {
    db.prepare("INSERT INTO game_progress (user_id, unlocked_world, unlocked_stage) VALUES (?, 1, 1)").run(userId);
    row = db.prepare("SELECT * FROM game_progress WHERE user_id = ?").get(userId);
  }
  return row;
}

// ---------- GET /api/game/progress ----------
// ดึงจุดปลดล็อคไกลสุดของผู้ใช้ปัจจุบัน (world/stage ก่อนหน้าจุดนี้ถือว่าปลดล็อคหมดแล้ว)
router.get("/progress", requireAuth, (req, res) => {
  const progress = getOrCreateProgress(req.user.id);
  return res.json({
    unlockedWorld: progress.unlocked_world,
    unlockedStage: progress.unlocked_stage,
    totalWorlds: TOTAL_WORLDS,
    stagesPerWorld: STAGES_PER_WORLD,
  });
});

// ---------- POST /api/game/progress/complete ----------
// แจ้งว่าเล่นด่าน {world, stage} จบแล้ว เลื่อนจุดปลดล็อคไปด่านถัดไป
// กันโกง: อนุญาตให้ complete ได้เฉพาะด่านที่ "ปลดล็อคอยู่พอดี" เท่านั้น (ห้ามข้ามด่าน)
// หมายเหตุ: ยังไม่มีตัวเกมจริงหลังหน้า Title เลย endpoint นี้จึงยังไม่ถูกเรียกจากที่ไหนจริงๆ รอจุดที่เล่นด่านจบจริงในอนาคต
router.post("/progress/complete", requireAuth, (req, res) => {
  const { world, stage } = req.body;

  if (!Number.isInteger(world) || !Number.isInteger(stage)) {
    return res.status(400).json({ message: "world/stage ต้องเป็นตัวเลข" });
  }

  const progress = getOrCreateProgress(req.user.id);

  if (world !== progress.unlocked_world || stage !== progress.unlocked_stage) {
    return res.status(400).json({ message: "ด่านนี้ยังไม่ปลดล็อค หรือเล่นจบไปแล้ว" });
  }

  let nextWorld = progress.unlocked_world;
  let nextStage = progress.unlocked_stage + 1;
  if (nextStage > STAGES_PER_WORLD) {
    nextStage = 1;
    nextWorld = Math.min(TOTAL_WORLDS, progress.unlocked_world + 1);
  }

  db.prepare(
    "UPDATE game_progress SET unlocked_world = ?, unlocked_stage = ?, updated_at = datetime('now') WHERE user_id = ?"
  ).run(nextWorld, nextStage, req.user.id);

  return res.json({
    unlockedWorld: nextWorld,
    unlockedStage: nextStage,
    totalWorlds: TOTAL_WORLDS,
    stagesPerWorld: STAGES_PER_WORLD,
  });
});

module.exports = router;
