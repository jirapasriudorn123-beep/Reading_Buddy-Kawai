const express = require("express");
const db = require("../db/database");
const { requireAdmin } = require("../middleware/auth");
const { findChatAnswer } = require("./chat");
const { makeAdminUpload } = require("../utils/cloudinary");

const router = express.Router();

// ================== อัปโหลดไฟล์ (รูปภาพ/PDF) ==================
// เก็บบน Cloudinary — persistent (ไม่หายตอน Render restart) + มี CDN ให้เอง
const upload = makeAdminUpload((req) =>
  req.query.type === "product" ? "reading-buddy/products" : "reading-buddy/lessons"
);

router.post("/upload", requireAdmin, upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "อัปโหลดไฟล์ไม่สำเร็จ (ชนิดไฟล์ไม่รองรับ หรือไฟล์ใหญ่เกิน 20MB)" });
  }
  // multer-storage-cloudinary ใส่ URL เต็มไว้ใน req.file.path
  const url = req.file.path;
  const kind = req.file.mimetype === "application/pdf" ? "pdf" : "image";
  return res.json({ url, kind });
});

// ================== แดชบอร์ด ==================
router.get("/stats", requireAdmin, async (req, res, next) => {
  try {
    const [totalUsersRow, usersEndOfLastMonthRow, onlineUsersRow, totalReadingRow, totalCoinsSpentRow, gamePlayersRow, chartRows] = await Promise.all([
      db.prepare("SELECT COUNT(*) c FROM users WHERE is_admin = 0").get(),
      // จำนวน user ณ สิ้นเดือนที่แล้ว = users ที่สมัครก่อนวันที่ 1 เดือนนี้ (เวลาไทย)
      // ใช้เปรียบเทียบว่าเดือนนี้ user เพิ่มขึ้นกี่ % จากสิ้นเดือนที่แล้ว
      db
        .prepare(
          `SELECT COUNT(*) c FROM users
           WHERE is_admin = 0
             AND datetime(created_at, '+7 hours') < datetime('now', '+7 hours', 'start of month')`
        )
        .get(),
      db.prepare("SELECT COUNT(*) c FROM users WHERE last_active_at > datetime('now', '-5 minutes')").get(),
      db.prepare("SELECT COALESCE(SUM(planned_read_seconds), 0) s FROM reading_sessions WHERE status = 'completed'").get(),
      db.prepare(`SELECT COALESCE(SUM(i.count * p.price), 0) s FROM inventory i JOIN products p ON i.product_id = p.id`).get(),
      db.prepare("SELECT COUNT(DISTINCT user_id) c FROM game_progress").get(),
      db
        .prepare(
          `SELECT date(started_at, '+7 hours') as day,
                  COALESCE(SUM(planned_read_seconds), 0) as seconds,
                  COALESCE(SUM(coins_earned), 0) as coins
           FROM reading_sessions
           WHERE status = 'completed' AND started_at >= datetime('now', '-6 days')
           GROUP BY day
           ORDER BY day ASC`
        )
        .all(),
    ]);

    // คำนวณ % เปลี่ยนแปลงเทียบกับสิ้นเดือนที่แล้ว
    // - ถ้าเดือนที่แล้ว 0 คน → ส่ง newSinceLastMonth เป็นตัวเลขเพิ่ม (frontend จะโชว์ "+N คนใหม่")
    // - ถ้ามีอยู่แล้ว → คำนวณเป็น %
    const currentTotal = totalUsersRow.c;
    const lastMonthTotal = usersEndOfLastMonthRow.c;
    const newSinceLastMonth = currentTotal - lastMonthTotal;
    const usersChangePercent = lastMonthTotal > 0
      ? Math.round(((currentTotal - lastMonthTotal) / lastMonthTotal) * 100)
      : null; // null = ไม่มี baseline (เดือนที่แล้ว 0 คน)

    return res.json({
      totalUsers: currentTotal,
      usersChangePercent,       // % เทียบกับสิ้นเดือนที่แล้ว (null ถ้าไม่มี baseline)
      newSinceLastMonth,        // จำนวน user ใหม่ (absolute) — ใช้ตอน % คำนวณไม่ได้
      onlineUsers: onlineUsersRow.c,
      totalReadingHours: Math.round((totalReadingRow.s / 3600) * 10) / 10,
      totalCoinsSpent: totalCoinsSpentRow.s,
      gamePlayers: gamePlayersRow.c,
      chart: chartRows.map((r) => ({ day: r.day, minutes: Math.round(r.seconds / 60), coins: r.coins })),
    });
  } catch (err) {
    next(err);
  }
});

// ================== บทเรียน (chapters) ==================
router.get("/chapters", requireAdmin, async (req, res, next) => {
  try {
    const chapters = await db.prepare("SELECT * FROM chapters ORDER BY chapter_number ASC").all();
    return res.json({ chapters });
  } catch (err) {
    next(err);
  }
});

router.post("/chapters", requireAdmin, async (req, res) => {
  try {
    const { chapterNumber, title, detail, coinReward, imageUrl, pdfUrl } = req.body;
    if (!chapterNumber || !title || !title.trim()) {
      return res.status(400).json({ message: "กรุณากรอก Chapter และชื่อบทเรียน" });
    }
    const existing = await db.prepare("SELECT id FROM chapters WHERE chapter_number = ?").get(Number(chapterNumber));
    if (existing) {
      return res.status(409).json({ message: "มี Chapter หมายเลขนี้อยู่แล้ว" });
    }

    const result = await db
      .prepare(
        `INSERT INTO chapters (chapter_number, title, detail, coin_reward, image_url, pdf_url)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        Number(chapterNumber),
        title.trim(),
        detail ? detail.trim() : null,
        Number(coinReward) || 20,
        imageUrl || null,
        pdfUrl || null
      );

    const chapter = await db.prepare("SELECT * FROM chapters WHERE id = ?").get(result.lastInsertRowid);
    return res.status(201).json({ message: "เพิ่มบทเรียนสำเร็จ", chapter });
  } catch (err) {
    console.error("Create chapter error:", err);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์" });
  }
});

router.put("/chapters/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const chapter = await db.prepare("SELECT * FROM chapters WHERE id = ?").get(id);
    if (!chapter) return res.status(404).json({ message: "ไม่พบบทเรียนนี้" });

    const { chapterNumber, title, detail, coinReward, imageUrl, pdfUrl } = req.body;
    if (chapterNumber && Number(chapterNumber) !== chapter.chapter_number) {
      const dup = await db
        .prepare("SELECT id FROM chapters WHERE chapter_number = ? AND id != ?")
        .get(Number(chapterNumber), id);
      if (dup) return res.status(409).json({ message: "มี Chapter หมายเลขนี้อยู่แล้ว" });
    }

    await db.prepare(
      `UPDATE chapters SET chapter_number = ?, title = ?, detail = ?, coin_reward = ?, image_url = ?, pdf_url = ?
       WHERE id = ?`
    ).run(
      chapterNumber ? Number(chapterNumber) : chapter.chapter_number,
      title && title.trim() ? title.trim() : chapter.title,
      detail !== undefined ? (detail ? detail.trim() : null) : chapter.detail,
      coinReward !== undefined ? Number(coinReward) : chapter.coin_reward,
      imageUrl !== undefined ? imageUrl : chapter.image_url,
      pdfUrl !== undefined ? pdfUrl : chapter.pdf_url,
      id
    );

    const updated = await db.prepare("SELECT * FROM chapters WHERE id = ?").get(id);
    return res.json({ message: "อัปเดตบทเรียนสำเร็จ", chapter: updated });
  } catch (err) {
    console.error("Update chapter error:", err);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์" });
  }
});

router.delete("/chapters/:id", requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const chapter = await db.prepare("SELECT id FROM chapters WHERE id = ?").get(id);
    if (!chapter) return res.status(404).json({ message: "ไม่พบบทเรียนนี้" });
    await db.prepare("DELETE FROM chapters WHERE id = ?").run(id);
    return res.json({ message: "ลบบทเรียนสำเร็จ" });
  } catch (err) {
    next(err);
  }
});

// ================== ร้านค้า (products) ==================
router.get("/products", requireAdmin, async (req, res, next) => {
  try {
    const products = await db.prepare("SELECT * FROM products ORDER BY rowid ASC").all();
    return res.json({ products });
  } catch (err) {
    next(err);
  }
});

function makeProductId() {
  return "item-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}

const PET_ACTIONS = ["feed", "bath", "happiness", "sleep"];
const MAX_STAT_GAIN = 100;

function validatePetUse(petAction, statGain) {
  const action = petAction ? String(petAction) : null;
  if (action && !PET_ACTIONS.includes(action)) {
    throw new Error("ประเภทการใช้กับน้องหมาไม่ถูกต้อง");
  }

  if (!action) return [null, 0];

  const gain = Number(statGain);
  if (!Number.isInteger(gain) || gain < 1 || gain > MAX_STAT_GAIN) {
    throw new Error(`ค่าที่เติมให้น้องต้องเป็นจำนวนเต็ม 1-${MAX_STAT_GAIN}`);
  }
  return [action, gain];
}

router.post("/products", requireAdmin, async (req, res) => {
  try {
    const { name, price, img, category, description, tag, petAction, statGain } = req.body;
    if (!name || !name.trim() || !category || price === undefined || price === "") {
      return res.status(400).json({ message: "กรุณากรอกชื่อ ราคา และหมวดหมู่" });
    }
    if (Number(price) < 0) {
      return res.status(400).json({ message: "ราคาต้องไม่ติดลบ" });
    }

    let petUse;
    try {
      petUse = validatePetUse(petAction, statGain);
    } catch (validationErr) {
      return res.status(400).json({ message: validationErr.message });
    }

    const id = makeProductId();
    await db.prepare(
      `INSERT INTO products (id, name, price, img, category, description, tag, pet_action, stat_gain)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      name.trim(),
      Number(price),
      img || "placeholder.png",
      category,
      description ? description.trim() : null,
      tag || null,
      petUse[0],
      petUse[1]
    );

    const product = await db.prepare("SELECT * FROM products WHERE id = ?").get(id);
    return res.status(201).json({ message: "เพิ่มสินค้าสำเร็จ", product });
  } catch (err) {
    console.error("Create product error:", err);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์" });
  }
});

router.put("/products/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const product = await db.prepare("SELECT * FROM products WHERE id = ?").get(id);
    if (!product) return res.status(404).json({ message: "ไม่พบสินค้านี้" });

    const { name, price, img, category, description, tag, petAction, statGain } = req.body;
    if (price !== undefined && Number(price) < 0) {
      return res.status(400).json({ message: "ราคาต้องไม่ติดลบ" });
    }

    let petUse = [product.pet_action, product.stat_gain];
    if (petAction !== undefined) {
      try {
        petUse = validatePetUse(petAction, statGain !== undefined ? statGain : product.stat_gain);
      } catch (validationErr) {
        return res.status(400).json({ message: validationErr.message });
      }
    }

    await db.prepare(
      `UPDATE products SET name = ?, price = ?, img = ?, category = ?, description = ?, tag = ?,
                           pet_action = ?, stat_gain = ?
       WHERE id = ?`
    ).run(
      name && name.trim() ? name.trim() : product.name,
      price !== undefined && price !== "" ? Number(price) : product.price,
      img !== undefined ? img : product.img,
      category || product.category,
      description !== undefined ? (description ? description.trim() : null) : product.description,
      tag !== undefined ? (tag || null) : product.tag,
      petUse[0],
      petUse[1],
      id
    );

    const updated = await db.prepare("SELECT * FROM products WHERE id = ?").get(id);
    return res.json({ message: "อัปเดตสินค้าสำเร็จ", product: updated });
  } catch (err) {
    console.error("Update product error:", err);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์" });
  }
});

router.delete("/products/:id", requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const product = await db.prepare("SELECT id FROM products WHERE id = ?").get(id);
    if (!product) return res.status(404).json({ message: "ไม่พบสินค้านี้" });
    await db.prepare("DELETE FROM products WHERE id = ?").run(id);
    return res.json({ message: "ลบสินค้าสำเร็จ" });
  } catch (err) {
    next(err);
  }
});

// ================== ผู้ใช้ ==================
router.get("/users", requireAdmin, async (req, res, next) => {
  try {
    const search = (req.query.search || "").trim();
    let rows;
    if (search) {
      const term = `%${search}%`;
      rows = await db
        .prepare(
          `SELECT id, email, username, coins, is_admin, last_active_at, created_at FROM users
           WHERE username LIKE ? OR email LIKE ? ORDER BY created_at DESC`
        )
        .all(term, term);
    } else {
      rows = await db
        .prepare(
          `SELECT id, email, username, coins, is_admin, last_active_at, created_at FROM users ORDER BY created_at DESC`
        )
        .all();
    }
    return res.json({ users: rows });
  } catch (err) {
    next(err);
  }
});

router.delete("/users/:id", requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    if (Number(id) === req.user.id) {
      return res.status(400).json({ message: "ลบบัญชีแอดมินที่ใช้งานอยู่ตอนนี้ไม่ได้" });
    }
    const user = await db.prepare("SELECT id FROM users WHERE id = ?").get(id);
    if (!user) return res.status(404).json({ message: "ไม่พบผู้ใช้นี้" });
    await db.prepare("DELETE FROM users WHERE id = ?").run(id);
    return res.json({ message: "ลบผู้ใช้สำเร็จ" });
  } catch (err) {
    next(err);
  }
});

// ================== คะแนน/อันดับ ==================
router.get("/scores", requireAdmin, async (req, res, next) => {
  try {
    const [byCoins, byReadingRaw] = await Promise.all([
      db.prepare("SELECT username, coins FROM users WHERE is_admin = 0 ORDER BY coins DESC LIMIT 20").all(),
      db
        .prepare(
          `SELECT u.username, COALESCE(SUM(rs.planned_read_seconds), 0) as totalSeconds
           FROM users u
           LEFT JOIN reading_sessions rs ON rs.user_id = u.id AND rs.status = 'completed'
           WHERE u.is_admin = 0
           GROUP BY u.id
           ORDER BY totalSeconds DESC
           LIMIT 20`
        )
        .all(),
    ]);
    const byReading = byReadingRaw.map((r) => ({ username: r.username, totalMinutes: Math.round(r.totalSeconds / 60) }));
    return res.json({ byCoins, byReading });
  } catch (err) {
    next(err);
  }
});

// ================== คลังคำตอบแชทบอท (chat_answers) ==================

function normalizeKeywords(raw) {
  if (typeof raw !== "string") return [];
  const seen = new Set();
  return raw
    .split(",")
    .map((k) => k.trim())
    .filter((k) => {
      const lower = k.toLowerCase();
      if (!k || seen.has(lower)) return false;
      seen.add(lower);
      return true;
    });
}

router.get("/chat-answers", requireAdmin, async (req, res, next) => {
  try {
    const answers = await db
      .prepare(
        `SELECT ca.*, c.chapter_number, c.title AS chapter_title, u.username AS created_by_name
         FROM chat_answers ca
         LEFT JOIN chapters c ON c.id = ca.chapter_id
         LEFT JOIN users u ON u.id = ca.created_by
         ORDER BY c.chapter_number ASC, ca.id ASC`
      )
      .all();
    return res.json({ answers });
  } catch (err) {
    next(err);
  }
});

router.post("/chat-answers", requireAdmin, async (req, res) => {
  try {
    const { chapterId, keywords, answer } = req.body;

    const keywordList = normalizeKeywords(keywords);
    if (!keywordList.length) {
      return res.status(400).json({ message: "กรุณากรอกคำสำคัญอย่างน้อย 1 คำ (คั่นด้วยจุลภาค)" });
    }
    if (!answer || !answer.trim()) {
      return res.status(400).json({ message: "กรุณากรอกคำตอบ" });
    }
    if (chapterId) {
      const chapterExists = await db.prepare("SELECT id FROM chapters WHERE id = ?").get(Number(chapterId));
      if (!chapterExists) {
        return res.status(404).json({ message: "ไม่พบบทเรียนที่เลือก" });
      }
    }

    const result = await db
      .prepare(
        `INSERT INTO chat_answers (chapter_id, keywords, answer, created_by) VALUES (?, ?, ?, ?)`
      )
      .run(chapterId ? Number(chapterId) : null, keywordList.join(","), answer.trim(), req.user.id);

    const created = await db.prepare("SELECT * FROM chat_answers WHERE id = ?").get(result.lastInsertRowid);
    return res.status(201).json({ message: "เพิ่มคำตอบสำเร็จ", answer: created });
  } catch (err) {
    console.error("Create chat answer error:", err);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์" });
  }
});

router.put("/chat-answers/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await db.prepare("SELECT * FROM chat_answers WHERE id = ?").get(id);
    if (!existing) return res.status(404).json({ message: "ไม่พบคำตอบนี้" });

    const { chapterId, keywords, answer } = req.body;

    const keywordList = keywords !== undefined ? normalizeKeywords(keywords) : null;
    if (keywordList && !keywordList.length) {
      return res.status(400).json({ message: "กรุณากรอกคำสำคัญอย่างน้อย 1 คำ (คั่นด้วยจุลภาค)" });
    }
    if (answer !== undefined && !answer.trim()) {
      return res.status(400).json({ message: "กรุณากรอกคำตอบ" });
    }
    if (chapterId) {
      const chapterExists = await db.prepare("SELECT id FROM chapters WHERE id = ?").get(Number(chapterId));
      if (!chapterExists) {
        return res.status(404).json({ message: "ไม่พบบทเรียนที่เลือก" });
      }
    }

    await db.prepare(
      `UPDATE chat_answers SET chapter_id = ?, keywords = ?, answer = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      chapterId !== undefined ? (chapterId ? Number(chapterId) : null) : existing.chapter_id,
      keywordList ? keywordList.join(",") : existing.keywords,
      answer !== undefined ? answer.trim() : existing.answer,
      id
    );

    const updated = await db.prepare("SELECT * FROM chat_answers WHERE id = ?").get(id);
    return res.json({ message: "อัปเดตคำตอบสำเร็จ", answer: updated });
  } catch (err) {
    console.error("Update chat answer error:", err);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์" });
  }
});

router.delete("/chat-answers/:id", requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await db.prepare("SELECT id FROM chat_answers WHERE id = ?").get(id);
    if (!existing) return res.status(404).json({ message: "ไม่พบคำตอบนี้" });
    await db.prepare("DELETE FROM chat_answers WHERE id = ?").run(id);
    return res.json({ message: "ลบคำตอบสำเร็จ" });
  } catch (err) {
    next(err);
  }
});

// ---------- POST /api/admin/chat-answers/test ----------
router.post("/chat-answers/test", requireAdmin, async (req, res, next) => {
  try {
    const { message } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ message: "กรุณาพิมพ์คำถามที่ต้องการทดสอบ" });
    }
    const match = await findChatAnswer(message.trim());
    return res.json(match);
  } catch (err) {
    next(err);
  }
});

// ================== จัดการมินิเกม (game config ต่อบทเรียน) ==================
// GET รายการบท + ค่ามินิเกมที่แอดมินตั้งไว้ (required_minutes, question_count, enabled)
router.get("/game-config", requireAdmin, async (req, res, next) => {
  try {
    const chapters = await db
      .prepare(
        `SELECT id, chapter_number, title, game_required_minutes, game_question_count, game_enabled
         FROM chapters ORDER BY chapter_number ASC`
      )
      .all();
    return res.json({ chapters });
  } catch (err) {
    next(err);
  }
});

// PUT อัปเดตค่ามินิเกมของบทหนึ่งๆ (ไม่แตะฟิลด์อื่นของบท เช่น title/pdf_url)
router.put("/game-config/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const chapter = await db
      .prepare("SELECT id, game_required_minutes, game_question_count, game_enabled FROM chapters WHERE id = ?")
      .get(id);
    if (!chapter) return res.status(404).json({ message: "ไม่พบบทเรียนนี้" });

    const { requiredMinutes, questionCount, enabled } = req.body;

    // validate เฉพาะฟิลด์ที่ส่งมา (ไม่บังคับส่งครบทุกฟิลด์)
    let newRequiredMinutes = chapter.game_required_minutes;
    if (requiredMinutes !== undefined) {
      const n = Number(requiredMinutes);
      if (!Number.isInteger(n) || n < 0 || n > 240) {
        return res.status(400).json({ message: "เวลาอ่านต้องเป็นจำนวนเต็ม 0-240 นาที" });
      }
      newRequiredMinutes = n;
    }

    let newQuestionCount = chapter.game_question_count;
    if (questionCount !== undefined) {
      const n = Number(questionCount);
      if (!Number.isInteger(n) || n < 1 || n > 50) {
        return res.status(400).json({ message: "จำนวนคำถามต้องเป็น 1-50 ข้อ" });
      }
      newQuestionCount = n;
    }

    let newEnabled = chapter.game_enabled;
    if (enabled !== undefined) {
      newEnabled = enabled ? 1 : 0;
    }

    await db
      .prepare(
        "UPDATE chapters SET game_required_minutes = ?, game_question_count = ?, game_enabled = ? WHERE id = ?"
      )
      .run(newRequiredMinutes, newQuestionCount, newEnabled, id);

    const updated = await db
      .prepare(
        "SELECT id, chapter_number, title, game_required_minutes, game_question_count, game_enabled FROM chapters WHERE id = ?"
      )
      .get(id);
    return res.json({ message: "บันทึกสำเร็จ", chapter: updated });
  } catch (err) {
    console.error("Update game config error:", err);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์" });
  }
});

// ================== จัดการคำถามในมินิเกม (quiz_questions) ==================
// list ตามบท — แอดมินเปิดหน้า "แก้ไข" ของบทไหนก็ดึงเฉพาะบทนั้น
router.get("/game-questions/chapter/:chapterId", requireAdmin, async (req, res, next) => {
  try {
    const chapterId = Number(req.params.chapterId);
    const [chapter, questions] = await Promise.all([
      db
        .prepare(
          `SELECT id, chapter_number, title, game_required_minutes, game_question_count, game_enabled
           FROM chapters WHERE id = ?`
        )
        .get(chapterId),
      db
        .prepare(
          `SELECT id, chapter_id, level, question, option_1, option_2, option_3, option_4,
                  correct_option, enabled, created_at
           FROM quiz_questions WHERE chapter_id = ? ORDER BY level ASC, id ASC`
        )
        .all(chapterId),
    ]);
    if (!chapter) return res.status(404).json({ message: "ไม่พบบทเรียนนี้" });
    return res.json({ chapter, questions });
  } catch (err) {
    next(err);
  }
});

// validate payload คำถามให้ครบและถูกช่วง — ใช้ทั้งตอน POST และ PUT
function validateQuestionPayload(body) {
  const q = String(body.question || "").trim();
  const options = [1, 2, 3, 4].map((i) => String(body["option_" + i] || "").trim());
  const level = Number(body.level);
  const correct = Number(body.correctOption);

  if (!q) return { error: "กรุณากรอกคำถาม" };
  if (options.some((o) => !o)) return { error: "กรุณากรอกตัวเลือกให้ครบทั้ง 4 ข้อ" };
  if (!Number.isInteger(level) || level < 1 || level > 20) {
    return { error: "ระดับต้องเป็นจำนวนเต็ม 1-20" };
  }
  if (!Number.isInteger(correct) || correct < 1 || correct > 4) {
    return { error: "ต้องเลือกคำตอบที่ถูก (1-4)" };
  }
  return { question: q, options, level, correct };
}

router.post("/game-questions", requireAdmin, async (req, res) => {
  try {
    const chapterId = Number(req.body.chapterId);
    const chapter = await db.prepare("SELECT id FROM chapters WHERE id = ?").get(chapterId);
    if (!chapter) return res.status(400).json({ message: "ไม่พบบทเรียนที่ระบุ" });

    const v = validateQuestionPayload(req.body);
    if (v.error) return res.status(400).json({ message: v.error });

    const result = await db
      .prepare(
        `INSERT INTO quiz_questions
         (chapter_id, level, question, option_1, option_2, option_3, option_4, correct_option)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(chapterId, v.level, v.question, v.options[0], v.options[1], v.options[2], v.options[3], v.correct);

    const created = await db
      .prepare("SELECT * FROM quiz_questions WHERE id = ?")
      .get(result.lastInsertRowid);
    return res.status(201).json({ message: "เพิ่มคำถามสำเร็จ", question: created });
  } catch (err) {
    console.error("Create quiz question error:", err);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์" });
  }
});

router.put("/game-questions/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await db.prepare("SELECT id FROM quiz_questions WHERE id = ?").get(id);
    if (!existing) return res.status(404).json({ message: "ไม่พบคำถามนี้" });

    const v = validateQuestionPayload(req.body);
    if (v.error) return res.status(400).json({ message: v.error });

    await db
      .prepare(
        `UPDATE quiz_questions
         SET level = ?, question = ?, option_1 = ?, option_2 = ?, option_3 = ?, option_4 = ?, correct_option = ?
         WHERE id = ?`
      )
      .run(v.level, v.question, v.options[0], v.options[1], v.options[2], v.options[3], v.correct, id);

    const updated = await db.prepare("SELECT * FROM quiz_questions WHERE id = ?").get(id);
    return res.json({ message: "อัปเดตคำถามสำเร็จ", question: updated });
  } catch (err) {
    console.error("Update quiz question error:", err);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์" });
  }
});

router.patch("/game-questions/:id/toggle", requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const q = await db.prepare("SELECT id, enabled FROM quiz_questions WHERE id = ?").get(id);
    if (!q) return res.status(404).json({ message: "ไม่พบคำถามนี้" });
    const nextVal = q.enabled ? 0 : 1;
    await db.prepare("UPDATE quiz_questions SET enabled = ? WHERE id = ?").run(nextVal, id);
    return res.json({ id: q.id, enabled: nextVal });
  } catch (err) {
    next(err);
  }
});

router.delete("/game-questions/:id", requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await db.prepare("SELECT id FROM quiz_questions WHERE id = ?").get(id);
    if (!existing) return res.status(404).json({ message: "ไม่พบคำถามนี้" });
    await db.prepare("DELETE FROM quiz_questions WHERE id = ?").run(id);
    return res.json({ message: "ลบคำถามสำเร็จ" });
  } catch (err) {
    next(err);
  }
});

// ================== มินิเกม (Phayao Adventure) — ความคืบหน้าผู้เล่น ==================
router.get("/game-progress", requireAdmin, async (req, res, next) => {
  try {
    const players = await db
      .prepare(
        `SELECT u.username, gp.unlocked_world, gp.unlocked_stage, gp.updated_at
         FROM game_progress gp
         JOIN users u ON u.id = gp.user_id
         ORDER BY gp.unlocked_world DESC, gp.unlocked_stage DESC`
      )
      .all();

    return res.json({ players, totalPlayers: players.length });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
