const express = require("express");
const path = require("path");
const multer = require("multer");
const db = require("../db/database");
const { requireAdmin } = require("../middleware/auth");
const { findChatAnswer } = require("./chat");

const router = express.Router();

// ================== อัปโหลดไฟล์ (รูปภาพ/PDF) ==================
// เก็บไว้ที่ BACKEND/uploads/{lessons|products}/ แล้ว serve ผ่าน /uploads (ตั้งไว้ใน server.js แล้ว)
const uploadsRoot = path.join(__dirname, "..", "..", "uploads");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const sub = req.query.type === "product" ? "products" : "lessons";
    cb(null, path.join(uploadsRoot, sub));
  },
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || "").replace(/[^a-zA-Z0-9.]/g, "");
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

const ALLOWED_MIME = ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"];
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => cb(null, ALLOWED_MIME.includes(file.mimetype)),
});

// body: multipart/form-data ฟิลด์ "file" | query: ?type=lesson|product (ใช้เลือกโฟลเดอร์ปลายทาง)
router.post("/upload", requireAdmin, upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "อัปโหลดไฟล์ไม่สำเร็จ (ชนิดไฟล์ไม่รองรับ หรือไฟล์ใหญ่เกิน 20MB)" });
  }
  const sub = req.query.type === "product" ? "products" : "lessons";
  const url = `/uploads/${sub}/${req.file.filename}`;
  const kind = req.file.mimetype === "application/pdf" ? "pdf" : "image";
  return res.json({ url, kind });
});

// ================== แดชบอร์ด ==================
router.get("/stats", requireAdmin, (req, res) => {
  const totalUsers = db.prepare("SELECT COUNT(*) c FROM users WHERE is_admin = 0").get().c;
  const onlineUsers = db
    .prepare("SELECT COUNT(*) c FROM users WHERE last_active_at > datetime('now', '-5 minutes')")
    .get().c;
  const totalReadingSeconds = db
    .prepare("SELECT COALESCE(SUM(planned_read_seconds), 0) s FROM reading_sessions WHERE status = 'completed'")
    .get().s;
  const totalCoinsSpent = db
    .prepare(
      `SELECT COALESCE(SUM(i.count * p.price), 0) s FROM inventory i JOIN products p ON i.product_id = p.id`
    )
    .get().s;
  const gamePlayers = db.prepare("SELECT COUNT(DISTINCT user_id) c FROM game_progress").get().c;

  const chartRows = db
    .prepare(
      `SELECT date(started_at) as day,
              COALESCE(SUM(planned_read_seconds), 0) as seconds,
              COALESCE(SUM(coins_earned), 0) as coins
       FROM reading_sessions
       WHERE status = 'completed' AND started_at >= datetime('now', '-6 days')
       GROUP BY day
       ORDER BY day ASC`
    )
    .all();

  return res.json({
    totalUsers,
    onlineUsers,
    totalReadingHours: Math.round((totalReadingSeconds / 3600) * 10) / 10,
    totalCoinsSpent,
    gamePlayers,
    chart: chartRows.map((r) => ({ day: r.day, minutes: Math.round(r.seconds / 60), coins: r.coins })),
  });
});

// ================== บทเรียน (chapters) ==================
router.get("/chapters", requireAdmin, (req, res) => {
  const chapters = db.prepare("SELECT * FROM chapters ORDER BY chapter_number ASC").all();
  return res.json({ chapters });
});

router.post("/chapters", requireAdmin, (req, res) => {
  try {
    const { chapterNumber, title, detail, coinReward, imageUrl, pdfUrl } = req.body;
    if (!chapterNumber || !title || !title.trim()) {
      return res.status(400).json({ message: "กรุณากรอก Chapter และชื่อบทเรียน" });
    }
    const existing = db.prepare("SELECT id FROM chapters WHERE chapter_number = ?").get(Number(chapterNumber));
    if (existing) {
      return res.status(409).json({ message: "มี Chapter หมายเลขนี้อยู่แล้ว" });
    }

    const result = db
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

    const chapter = db.prepare("SELECT * FROM chapters WHERE id = ?").get(result.lastInsertRowid);
    return res.status(201).json({ message: "เพิ่มบทเรียนสำเร็จ", chapter });
  } catch (err) {
    console.error("Create chapter error:", err);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์" });
  }
});

router.put("/chapters/:id", requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const chapter = db.prepare("SELECT * FROM chapters WHERE id = ?").get(id);
    if (!chapter) return res.status(404).json({ message: "ไม่พบบทเรียนนี้" });

    const { chapterNumber, title, detail, coinReward, imageUrl, pdfUrl } = req.body;
    if (chapterNumber && Number(chapterNumber) !== chapter.chapter_number) {
      const dup = db
        .prepare("SELECT id FROM chapters WHERE chapter_number = ? AND id != ?")
        .get(Number(chapterNumber), id);
      if (dup) return res.status(409).json({ message: "มี Chapter หมายเลขนี้อยู่แล้ว" });
    }

    db.prepare(
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

    const updated = db.prepare("SELECT * FROM chapters WHERE id = ?").get(id);
    return res.json({ message: "อัปเดตบทเรียนสำเร็จ", chapter: updated });
  } catch (err) {
    console.error("Update chapter error:", err);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์" });
  }
});

router.delete("/chapters/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  const chapter = db.prepare("SELECT id FROM chapters WHERE id = ?").get(id);
  if (!chapter) return res.status(404).json({ message: "ไม่พบบทเรียนนี้" });
  db.prepare("DELETE FROM chapters WHERE id = ?").run(id);
  return res.json({ message: "ลบบทเรียนสำเร็จ" });
});

// ================== ร้านค้า (products) ==================
router.get("/products", requireAdmin, (req, res) => {
  const products = db.prepare("SELECT * FROM products ORDER BY rowid ASC").all();
  return res.json({ products });
});

function makeProductId() {
  return "item-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}

// ไอเทมใช้กับน้องหมาได้ 4 แบบ (ต้องตรงกับ ACTION_STAT ใน routes/pet.js) ค่าว่าง = เป็นของสะสม ใช้ไม่ได้
const PET_ACTIONS = ["feed", "bath", "happiness", "sleep"];
const MAX_STAT_GAIN = 100;

// คืน [petAction, statGain] ที่ตรวจแล้ว หรือโยน Error พร้อมข้อความถ้าไม่ถูกต้อง
function validatePetUse(petAction, statGain) {
  const action = petAction ? String(petAction) : null;
  if (action && !PET_ACTIONS.includes(action)) {
    throw new Error("ประเภทการใช้กับน้องหมาไม่ถูกต้อง");
  }

  // ของสะสมไม่ต้องมีค่าเติมสถานะ
  if (!action) return [null, 0];

  const gain = Number(statGain);
  if (!Number.isInteger(gain) || gain < 1 || gain > MAX_STAT_GAIN) {
    throw new Error(`ค่าที่เติมให้น้องต้องเป็นจำนวนเต็ม 1-${MAX_STAT_GAIN}`);
  }
  return [action, gain];
}

router.post("/products", requireAdmin, (req, res) => {
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
    db.prepare(
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

    const product = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
    return res.status(201).json({ message: "เพิ่มสินค้าสำเร็จ", product });
  } catch (err) {
    console.error("Create product error:", err);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์" });
  }
});

router.put("/products/:id", requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const product = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
    if (!product) return res.status(404).json({ message: "ไม่พบสินค้านี้" });

    const { name, price, img, category, description, tag, petAction, statGain } = req.body;
    if (price !== undefined && Number(price) < 0) {
      return res.status(400).json({ message: "ราคาต้องไม่ติดลบ" });
    }

    // ไม่ได้ส่ง petAction มาเลย = ไม่แตะค่าเดิม
    let petUse = [product.pet_action, product.stat_gain];
    if (petAction !== undefined) {
      try {
        petUse = validatePetUse(petAction, statGain !== undefined ? statGain : product.stat_gain);
      } catch (validationErr) {
        return res.status(400).json({ message: validationErr.message });
      }
    }

    db.prepare(
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

    const updated = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
    return res.json({ message: "อัปเดตสินค้าสำเร็จ", product: updated });
  } catch (err) {
    console.error("Update product error:", err);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์" });
  }
});

router.delete("/products/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  const product = db.prepare("SELECT id FROM products WHERE id = ?").get(id);
  if (!product) return res.status(404).json({ message: "ไม่พบสินค้านี้" });
  db.prepare("DELETE FROM products WHERE id = ?").run(id);
  return res.json({ message: "ลบสินค้าสำเร็จ" });
});

// ================== ผู้ใช้ ==================
router.get("/users", requireAdmin, (req, res) => {
  const search = (req.query.search || "").trim();
  let rows;
  if (search) {
    const term = `%${search}%`;
    rows = db
      .prepare(
        `SELECT id, email, username, coins, is_admin, last_active_at, created_at FROM users
         WHERE username LIKE ? OR email LIKE ? ORDER BY created_at DESC`
      )
      .all(term, term);
  } else {
    rows = db
      .prepare(
        `SELECT id, email, username, coins, is_admin, last_active_at, created_at FROM users ORDER BY created_at DESC`
      )
      .all();
  }
  return res.json({ users: rows });
});

router.delete("/users/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  if (Number(id) === req.user.id) {
    return res.status(400).json({ message: "ลบบัญชีแอดมินที่ใช้งานอยู่ตอนนี้ไม่ได้" });
  }
  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(id);
  if (!user) return res.status(404).json({ message: "ไม่พบผู้ใช้นี้" });
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
  return res.json({ message: "ลบผู้ใช้สำเร็จ" });
});

// ================== คะแนน/อันดับ ==================
router.get("/scores", requireAdmin, (req, res) => {
  const byCoins = db
    .prepare("SELECT username, coins FROM users WHERE is_admin = 0 ORDER BY coins DESC LIMIT 20")
    .all();

  const byReading = db
    .prepare(
      `SELECT u.username, COALESCE(SUM(rs.planned_read_seconds), 0) as totalSeconds
       FROM users u
       LEFT JOIN reading_sessions rs ON rs.user_id = u.id AND rs.status = 'completed'
       WHERE u.is_admin = 0
       GROUP BY u.id
       ORDER BY totalSeconds DESC
       LIMIT 20`
    )
    .all()
    .map((r) => ({ username: r.username, totalMinutes: Math.round(r.totalSeconds / 60) }));

  return res.json({ byCoins, byReading });
});

// ================== คลังคำตอบแชทบอท (chat_answers) ==================
// แอดมินหลายคนช่วยกันเพิ่มคำตอบได้จากหน้าเว็บ ไม่ต้องแก้โค้ดแล้วรีสตาร์ทเซิร์ฟเวอร์

// แปลงคำสำคัญที่แอดมินพิมพ์มา (คั่นด้วยจุลภาค) ให้เป็นรูปแบบมาตรฐาน: ตัดช่องว่างหัวท้าย ตัดตัวซ้ำ ตัดตัวว่าง
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

router.get("/chat-answers", requireAdmin, (req, res) => {
  const answers = db
    .prepare(
      `SELECT ca.*, c.chapter_number, c.title AS chapter_title, u.username AS created_by_name
       FROM chat_answers ca
       LEFT JOIN chapters c ON c.id = ca.chapter_id
       LEFT JOIN users u ON u.id = ca.created_by
       ORDER BY c.chapter_number ASC, ca.id ASC`
    )
    .all();
  return res.json({ answers });
});

router.post("/chat-answers", requireAdmin, (req, res) => {
  try {
    const { chapterId, keywords, answer } = req.body;

    const keywordList = normalizeKeywords(keywords);
    if (!keywordList.length) {
      return res.status(400).json({ message: "กรุณากรอกคำสำคัญอย่างน้อย 1 คำ (คั่นด้วยจุลภาค)" });
    }
    if (!answer || !answer.trim()) {
      return res.status(400).json({ message: "กรุณากรอกคำตอบ" });
    }
    if (chapterId && !db.prepare("SELECT id FROM chapters WHERE id = ?").get(Number(chapterId))) {
      return res.status(404).json({ message: "ไม่พบบทเรียนที่เลือก" });
    }

    const result = db
      .prepare(
        `INSERT INTO chat_answers (chapter_id, keywords, answer, created_by) VALUES (?, ?, ?, ?)`
      )
      .run(chapterId ? Number(chapterId) : null, keywordList.join(","), answer.trim(), req.user.id);

    const created = db.prepare("SELECT * FROM chat_answers WHERE id = ?").get(result.lastInsertRowid);
    return res.status(201).json({ message: "เพิ่มคำตอบสำเร็จ", answer: created });
  } catch (err) {
    console.error("Create chat answer error:", err);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์" });
  }
});

router.put("/chat-answers/:id", requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.prepare("SELECT * FROM chat_answers WHERE id = ?").get(id);
    if (!existing) return res.status(404).json({ message: "ไม่พบคำตอบนี้" });

    const { chapterId, keywords, answer } = req.body;

    const keywordList = keywords !== undefined ? normalizeKeywords(keywords) : null;
    if (keywordList && !keywordList.length) {
      return res.status(400).json({ message: "กรุณากรอกคำสำคัญอย่างน้อย 1 คำ (คั่นด้วยจุลภาค)" });
    }
    if (answer !== undefined && !answer.trim()) {
      return res.status(400).json({ message: "กรุณากรอกคำตอบ" });
    }
    if (chapterId && !db.prepare("SELECT id FROM chapters WHERE id = ?").get(Number(chapterId))) {
      return res.status(404).json({ message: "ไม่พบบทเรียนที่เลือก" });
    }

    db.prepare(
      `UPDATE chat_answers SET chapter_id = ?, keywords = ?, answer = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      chapterId !== undefined ? (chapterId ? Number(chapterId) : null) : existing.chapter_id,
      keywordList ? keywordList.join(",") : existing.keywords,
      answer !== undefined ? answer.trim() : existing.answer,
      id
    );

    const updated = db.prepare("SELECT * FROM chat_answers WHERE id = ?").get(id);
    return res.json({ message: "อัปเดตคำตอบสำเร็จ", answer: updated });
  } catch (err) {
    console.error("Update chat answer error:", err);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์" });
  }
});

router.delete("/chat-answers/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  const existing = db.prepare("SELECT id FROM chat_answers WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ message: "ไม่พบคำตอบนี้" });
  db.prepare("DELETE FROM chat_answers WHERE id = ?").run(id);
  return res.json({ message: "ลบคำตอบสำเร็จ" });
});

// ---------- POST /api/admin/chat-answers/test ----------
// ให้แอดมินลองพิมพ์คำถามดูว่าจะเข้าคำตอบไหน ก่อนปล่อยให้นักเรียนใช้จริง
router.post("/chat-answers/test", requireAdmin, (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ message: "กรุณาพิมพ์คำถามที่ต้องการทดสอบ" });
  }
  const match = findChatAnswer(message.trim());
  return res.json(match);
});

// ================== มินิเกม (Phayao Adventure) ==================
router.get("/game-progress", requireAdmin, (req, res) => {
  const players = db
    .prepare(
      `SELECT u.username, gp.unlocked_world, gp.unlocked_stage, gp.updated_at
       FROM game_progress gp
       JOIN users u ON u.id = gp.user_id
       ORDER BY gp.unlocked_world DESC, gp.unlocked_stage DESC`
    )
    .all();

  return res.json({ players, totalPlayers: players.length });
});

module.exports = router;
