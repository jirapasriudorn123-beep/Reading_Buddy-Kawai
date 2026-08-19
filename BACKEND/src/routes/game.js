const express = require("express");
const db = require("../db/database");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// จำนวนเวิลด์ทั้งหมด และจำนวนด่านต่อเวิลด์ของ Phayao Adventure
// (ต้องตรงกับฝั่ง FRONTEND/stage-select.js)
const TOTAL_WORLDS = 6;
const STAGES_PER_WORLD = 4;

async function getOrCreateProgress(userId) {
  let row = await db.prepare("SELECT * FROM game_progress WHERE user_id = ?").get(userId);
  if (!row) {
    await db.prepare("INSERT INTO game_progress (user_id, unlocked_world, unlocked_stage) VALUES (?, 1, 1)").run(userId);
    row = await db.prepare("SELECT * FROM game_progress WHERE user_id = ?").get(userId);
  }
  return row;
}

// ---------- GET /api/game/progress ----------
router.get("/progress", requireAuth, async (req, res, next) => {
  try {
    const progress = await getOrCreateProgress(req.user.id);
    return res.json({
      unlockedWorld: progress.unlocked_world,
      unlockedStage: progress.unlocked_stage,
      totalWorlds: TOTAL_WORLDS,
      stagesPerWorld: STAGES_PER_WORLD,
    });
  } catch (err) {
    next(err);
  }
});

// ---------- POST /api/game/progress/complete ----------
router.post("/progress/complete", requireAuth, async (req, res, next) => {
  try {
    const { world, stage } = req.body;

    if (!Number.isInteger(world) || !Number.isInteger(stage)) {
      return res.status(400).json({ message: "world/stage ต้องเป็นตัวเลข" });
    }

    const progress = await getOrCreateProgress(req.user.id);

    if (world !== progress.unlocked_world || stage !== progress.unlocked_stage) {
      return res.status(400).json({ message: "ด่านนี้ยังไม่ปลดล็อค หรือเล่นจบไปแล้ว" });
    }

    let nextWorld = progress.unlocked_world;
    let nextStage = progress.unlocked_stage + 1;
    if (nextStage > STAGES_PER_WORLD) {
      nextStage = 1;
      nextWorld = Math.min(TOTAL_WORLDS, progress.unlocked_world + 1);
    }

    await db.prepare(
      "UPDATE game_progress SET unlocked_world = ?, unlocked_stage = ?, updated_at = datetime('now') WHERE user_id = ?"
    ).run(nextWorld, nextStage, req.user.id);

    return res.json({
      unlockedWorld: nextWorld,
      unlockedStage: nextStage,
      totalWorlds: TOTAL_WORLDS,
      stagesPerWorld: STAGES_PER_WORLD,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
