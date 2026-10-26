const express = require("express");
const bcrypt = require("bcrypt");
const db = require("../db/database");
const { requireAdmin } = require("../middleware/auth");
const { findChatAnswer } = require("./chat");
const { makeAdminUpload } = require("../utils/cloudinary");
const { getReadingRules, setDemoMode } = require("../services/readingRules");
const { DATASETS, buildCsv } = require("../services/researchExport");
const { getReadingStreaksForAll } = require("../services/petCare");
const { buildDashboard, buildDailyLearning, buildReadingByDay, buildReviewStats } = require("../services/adminDashboard");
const { buildUserReport } = require("../services/adminUserReport");

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
      db.prepare("SELECT COALESCE(SUM(read_seconds), 0) s FROM reading_sessions WHERE status = 'completed'").get(),
      db.prepare(`SELECT COALESCE(SUM(i.count * p.price), 0) s FROM inventory i JOIN products p ON i.product_id = p.id`).get(),
      db.prepare("SELECT COUNT(DISTINCT user_id) c FROM game_battles").get(),
      db
        .prepare(
          `SELECT date(started_at, '+7 hours') as day,
                  COALESCE(SUM(read_seconds), 0) as seconds,
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

// ================== รายงานรายคน (หน้า adminuser-detail.html) ==================
// GET /api/admin/users/:id/report — รายละเอียดการใช้งานของผู้ใช้คนเดียว (ดู services/adminUserReport.js)
router.get("/users/:id/report", requireAdmin, async (req, res, next) => {
  try {
    const report = await buildUserReport(Number(req.params.id));
    if (!report) return res.status(404).json({ message: "ไม่พบผู้ใช้คนนี้" });
    return res.json(report);
  } catch (err) {
    next(err);
  }
});

// ================== ฟีดแบ็กถึงนิสิตรายคน ==================
// POST /api/admin/users/:id/feedback — เขียนฟีดแบ็ก (นิสิตเห็นในกระดิ่งแจ้งเตือนของตัวเอง)
router.post("/users/:id/feedback", requireAdmin, async (req, res, next) => {
  try {
    const userId = Number(req.params.id);
    const message = String(req.body?.message || "").trim();
    if (!message) return res.status(400).json({ message: "พิมพ์ข้อความก่อนส่งนะ" });
    if (message.length > 5000) return res.status(400).json({ message: "ข้อความยาวเกินไป (เกิน 5,000 ตัวอักษร)" });

    const user = await db.prepare("SELECT id FROM users WHERE id = ? AND is_admin = 0").get(userId);
    if (!user) return res.status(404).json({ message: "ไม่พบผู้ใช้คนนี้" });

    const result = await db
      .prepare("INSERT INTO user_feedback (user_id, admin_id, sender, message) VALUES (?, ?, 'admin', ?)")
      .run(userId, req.user.id, message);
    const created = await db
      .prepare(
        `SELECT f.id, f.message, f.sender, datetime(f.created_at, '+7 hours') created_at, u.username admin_name
         FROM user_feedback f LEFT JOIN users u ON u.id = f.admin_id WHERE f.id = ?`
      )
      .get(result.lastInsertRowid);
    return res.status(201).json({ message: "ส่งฟีดแบ็กแล้ว", feedback: created });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/feedback/:id — ลบฟีดแบ็กที่เขียนไว้
router.delete("/feedback/:id", requireAdmin, async (req, res, next) => {
  try {
    // ลบได้ทั้งข้อความของอาจารย์และคำตอบของนิสิต (อาจารย์ดูแลบทสนทนาทั้งเส้น)
    const result = await db.prepare("DELETE FROM user_feedback WHERE id = ?").run(Number(req.params.id));
    if (!result.changes) return res.status(404).json({ message: "ไม่พบฟีดแบ็กนี้" });
    return res.json({ message: "ลบแล้ว" });
  } catch (err) {
    next(err);
  }
});

// ================== ตัวเลขทุกส่วนของหน้าแอดมินหลัก ==================
// GET /api/admin/stats/dashboard?range=7|30|90|365 — รายละเอียดการคำนวณดูที่ services/adminDashboard.js
router.get("/stats/dashboard", requireAdmin, async (req, res, next) => {
  try {
    return res.json(await buildDashboard(Number(req.query.range)));
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/stats/daily-learning?end=YYYY-MM-DD — ผู้เรียน/ผ่าน/ไม่ผ่าน 7 วันที่จบที่ end (ไม่ส่ง = วันนี้)
router.get("/stats/daily-learning", requireAdmin, async (req, res, next) => {
  try {
    return res.json(await buildDailyLearning(String(req.query.end || "")));
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/stats/reading-by-day?end=YYYY-MM-DD — นาทีที่อ่านและรอบอ่าน 7 วันที่จบที่ end (ไม่ส่ง = วันนี้)
router.get("/stats/reading-by-day", requireAdmin, async (req, res, next) => {
  try {
    return res.json(await buildReadingByDay(String(req.query.end || "")));
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/stats/review?range=all|7|30|90|365 — ภาพรวม / รายบุคคล / รายบทเรียนของการทบทวน
router.get("/stats/review", requireAdmin, async (req, res, next) => {
  try {
    return res.json(await buildReviewStats(String(req.query.range || "all")));
  } catch (err) {
    next(err);
  }
});

// ================== ส่งออกข้อมูลวิจัย (CSV) ==================
// GET /api/admin/export/users | days | sessions | reviews — รายละเอียดคอลัมน์ดูที่ services/researchExport.js
// GET /api/admin/export/:kind/data — ข้อมูลชุดเดียวกันเป็น JSON { columns, rows } ใช้แสดงเป็นตารางในหน้า "ข้อมูลวิจัย"
router.get("/export/:kind/data", requireAdmin, async (req, res, next) => {
  try {
    const build = DATASETS[req.params.kind];
    if (!build) return res.status(404).json({ message: "ไม่มีข้อมูลชุดนี้" });
    return res.json(await build());
  } catch (err) {
    next(err);
  }
});

router.get("/export/:kind", requireAdmin, async (req, res, next) => {
  try {
    if (!DATASETS[req.params.kind]) return res.status(404).json({ message: "ไม่มีข้อมูลชุดนี้" });
    const csv = await buildCsv(req.params.kind);
    const stamp = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, "");
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="reading-buddy-${req.params.kind}-${stamp}.csv"`);
    // frontend กับ backend อยู่คนละ origin — ต้องเปิดให้หน้าเว็บอ่านชื่อไฟล์จาก header นี้ได้
    res.set("Access-Control-Expose-Headers", "Content-Disposition");
    return res.send(csv);
  } catch (err) {
    next(err);
  }
});

// ================== โหมดสาธิตจับเวลาอ่าน ==================
// เปิด: ตั้งเวลาอ่านขั้นต่ำ 1 นาที ได้ 10 คอยน์ทุก 1 นาที (ใช้ตอนนำเสนอ) | ปิด: 10 นาที / 10 คอยน์ทุก 5 นาที ตามปกติ
router.get("/demo-mode", requireAdmin, async (req, res, next) => {
  try {
    return res.json({ readingRules: await getReadingRules() });
  } catch (err) {
    next(err);
  }
});

router.put("/demo-mode", requireAdmin, async (req, res, next) => {
  try {
    if (typeof req.body.enabled !== "boolean") {
      return res.status(400).json({ message: "enabled ต้องเป็น true หรือ false" });
    }
    const readingRules = await setDemoMode(req.body.enabled);
    return res.json({
      message: req.body.enabled ? "เปิดโหมดสาธิตแล้ว" : "ปิดโหมดสาธิตแล้ว กลับเป็นกติกาปกติ",
      readingRules,
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

// ช่องของคูปอง: มูลค่าส่วนลดที่ร้านจริง (บาท) + เงื่อนไขแลก (ผ่าน post กี่บท / ผ่านด่านบทเรียนในเกมกี่โลก)
// คืน [discountBaht, requiredPostChapters, requiredGameWorlds] — undefined = ไม่ได้ส่งมา (ใช้ค่าเดิม)
function validateCouponFields(body) {
  const parse = (value, label, max) => {
    if (value === undefined || value === null || value === "") return undefined;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > max) throw new Error(`${label}ต้องเป็นจำนวนเต็ม 0-${max}`);
    return n;
  };
  return [
    parse(body.discountBaht, "มูลค่าส่วนลด", 10000),
    parse(body.requiredPostChapters, "จำนวนบทที่ต้องผ่านแบบทดสอบหลังอ่าน", 100),
    parse(body.requiredGameWorlds, "จำนวนโลกที่ต้องผ่านในเกม", 6),
  ];
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

    let petUse, couponFields;
    try {
      petUse = validatePetUse(petAction, statGain);
      couponFields = validateCouponFields(req.body);
    } catch (validationErr) {
      return res.status(400).json({ message: validationErr.message });
    }

    const id = makeProductId();
    await db.prepare(
      `INSERT INTO products (id, name, price, img, category, description, tag, pet_action, stat_gain,
                             discount_baht, required_post_chapters, required_game_worlds)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      name.trim(),
      Number(price),
      img || "placeholder.png",
      category,
      description ? description.trim() : null,
      tag || null,
      petUse[0],
      petUse[1],
      couponFields[0] ?? 0,
      couponFields[1] ?? 0,
      couponFields[2] ?? 0
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
    let couponFields;
    try {
      if (petAction !== undefined) {
        petUse = validatePetUse(petAction, statGain !== undefined ? statGain : product.stat_gain);
      }
      couponFields = validateCouponFields(req.body);
    } catch (validationErr) {
      return res.status(400).json({ message: validationErr.message });
    }

    await db.prepare(
      `UPDATE products SET name = ?, price = ?, img = ?, category = ?, description = ?, tag = ?,
                           pet_action = ?, stat_gain = ?, discount_baht = ?,
                           required_post_chapters = ?, required_game_worlds = ?
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
      couponFields[0] ?? product.discount_baht,
      couponFields[1] ?? product.required_post_chapters,
      couponFields[2] ?? product.required_game_worlds,
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

// ================== ร้านค้าที่ร่วมรายการคูปอง ==================
const PIN_REGEX = /^\d{4,8}$/;

router.get("/shops", requireAdmin, async (req, res, next) => {
  try {
    const rows = await db
      .prepare(
        `SELECT ps.id, ps.name, ps.pin_hash IS NOT NULL AS hasPin, ps.locked_until AS lockedUntil,
                (SELECT COUNT(*) FROM user_coupons uc WHERE uc.used_shop_id = ps.id) AS usedCount
         FROM partner_shops ps ORDER BY ps.id ASC`
      )
      .all();
    return res.json({ shops: rows.map((r) => ({ ...r, hasPin: !!r.hasPin })) });
  } catch (err) {
    next(err);
  }
});

router.post("/shops", requireAdmin, async (req, res, next) => {
  try {
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    const pin = typeof req.body.pin === "string" ? req.body.pin.trim() : "";
    if (!name) return res.status(400).json({ message: "กรุณากรอกชื่อร้าน" });
    if (pin && !PIN_REGEX.test(pin)) return res.status(400).json({ message: "PIN ต้องเป็นตัวเลข 4-8 หลัก" });

    const dup = await db.prepare("SELECT id FROM partner_shops WHERE name = ?").get(name);
    if (dup) return res.status(409).json({ message: "มีร้านชื่อนี้อยู่แล้ว" });

    const pinHash = pin ? await bcrypt.hash(pin, 10) : null;
    await db.prepare("INSERT INTO partner_shops (name, pin_hash) VALUES (?, ?)").run(name, pinHash);
    return res.status(201).json({ message: "เพิ่มร้านสำเร็จ" });
  } catch (err) {
    next(err);
  }
});

// แก้ชื่อร้าน และ/หรือ ตั้ง PIN ใหม่ (ตั้ง PIN ใหม่ = ปลดล็อกร้านที่โดนล็อกจากใส่ PIN ผิดด้วย)
router.put("/shops/:id", requireAdmin, async (req, res, next) => {
  try {
    const shop = await db.prepare("SELECT id, name FROM partner_shops WHERE id = ?").get(req.params.id);
    if (!shop) return res.status(404).json({ message: "ไม่พบร้านนี้" });

    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    const pin = typeof req.body.pin === "string" ? req.body.pin.trim() : "";
    if (pin && !PIN_REGEX.test(pin)) return res.status(400).json({ message: "PIN ต้องเป็นตัวเลข 4-8 หลัก" });
    if (name && name !== shop.name) {
      const dup = await db.prepare("SELECT id FROM partner_shops WHERE name = ? AND id != ?").get(name, shop.id);
      if (dup) return res.status(409).json({ message: "มีร้านชื่อนี้อยู่แล้ว" });
      await db.prepare("UPDATE partner_shops SET name = ? WHERE id = ?").run(name, shop.id);
    }
    if (pin) {
      await db
        .prepare("UPDATE partner_shops SET pin_hash = ?, failed_pin_count = 0, locked_until = NULL WHERE id = ?")
        .run(await bcrypt.hash(pin, 10), shop.id);
    }
    return res.json({ message: "บันทึกร้านสำเร็จ" });
  } catch (err) {
    next(err);
  }
});

router.delete("/shops/:id", requireAdmin, async (req, res, next) => {
  try {
    const shop = await db.prepare("SELECT id FROM partner_shops WHERE id = ?").get(req.params.id);
    if (!shop) return res.status(404).json({ message: "ไม่พบร้านนี้" });
    await db.prepare("DELETE FROM partner_shops WHERE id = ?").run(shop.id);
    return res.json({ message: "ลบร้านสำเร็จ" });
  } catch (err) {
    next(err);
  }
});

// ================== รายงานคูปองที่แลกไปแล้ว ==================
router.get("/coupons", requireAdmin, async (req, res, next) => {
  try {
    const coupons = await db
      .prepare(
        `SELECT uc.code, uc.name, uc.discount_baht AS discountBaht, uc.price_coins AS priceCoins,
                CASE WHEN uc.status = 'used' THEN 'used'
                     WHEN uc.expires_at <= datetime('now') THEN 'expired'
                     ELSE 'active' END AS status,
                uc.created_at AS createdAt, uc.expires_at AS expiresAt, uc.used_at AS usedAt,
                u.username, ps.name AS usedShop
         FROM user_coupons uc
         LEFT JOIN users u ON u.id = uc.user_id
         LEFT JOIN partner_shops ps ON ps.id = uc.used_shop_id
         ORDER BY uc.created_at DESC`
      )
      .all();
    return res.json({ coupons });
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
    // วันอ่านล่าสุด + อ่านติดกันกี่วัน (ดูว่าใครหายไปจากการอ่าน)
    const streaks = await getReadingStreaksForAll();
    const users = rows.map((u) => {
      const st = streaks.get(u.id);
      return {
        ...u,
        lastReadDate: st ? st.lastReadDate : null,
        daysSinceRead: st ? st.daysSinceRead : null,
        currentStreak: st ? st.current : 0,
        longestStreak: st ? st.longest : 0,
      };
    });
    return res.json({ users });
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

// ================== ปรับคอยน์ของผู้ใช้ (เพิ่ม/ลด พร้อมเหตุผล) ==================
const MAX_COIN_ADJUST = 100000;
const MAX_ADJUST_REASON_LENGTH = 200;

// ประวัติการปรับคอยน์ของผู้ใช้ 1 คน (ล่าสุด 20 ครั้ง)
router.get("/users/:id/coins", requireAdmin, async (req, res, next) => {
  try {
    const user = await db.prepare("SELECT id, username, coins FROM users WHERE id = ?").get(req.params.id);
    if (!user) return res.status(404).json({ message: "ไม่พบผู้ใช้นี้" });
    const history = await db
      .prepare(
        `SELECT ca.amount, ca.reason, ca.balance_after AS balanceAfter, ca.created_at AS createdAt, a.username AS adminName
         FROM coin_adjustments ca
         LEFT JOIN users a ON a.id = ca.admin_id
         WHERE ca.user_id = ?
         ORDER BY ca.id DESC
         LIMIT 20`
      )
      .all(user.id);
    return res.json({ user, history });
  } catch (err) {
    next(err);
  }
});

// amount บวก = เพิ่ม, ลบ = หัก (หักจนติดลบไม่ได้)
router.post("/users/:id/coins", requireAdmin, async (req, res, next) => {
  try {
    const amount = Number(req.body.amount);
    const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : "";
    if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > MAX_COIN_ADJUST) {
      return res.status(400).json({ message: `จำนวนคอยน์ต้องเป็นจำนวนเต็ม ไม่เป็น 0 และไม่เกิน ${MAX_COIN_ADJUST}` });
    }
    if (!reason) return res.status(400).json({ message: "กรุณาระบุเหตุผล" });
    if (reason.length > MAX_ADJUST_REASON_LENGTH) {
      return res.status(400).json({ message: `เหตุผลยาวได้ไม่เกิน ${MAX_ADJUST_REASON_LENGTH} ตัวอักษร` });
    }

    const user = await db.prepare("SELECT id FROM users WHERE id = ?").get(req.params.id);
    if (!user) return res.status(404).json({ message: "ไม่พบผู้ใช้นี้" });

    const newBalance = await db.tx(async (t) => {
      // guard ในคำสั่งเดียว: หักได้เฉพาะถ้ายอดพอจริงตอน UPDATE
      const update = await t
        .prepare("UPDATE users SET coins = coins + ? WHERE id = ? AND coins + ? >= 0")
        .run(amount, user.id, amount);
      if (update.changes === 0) return null;
      const { coins } = await t.prepare("SELECT coins FROM users WHERE id = ?").get(user.id);
      await t
        .prepare("INSERT INTO coin_adjustments (user_id, admin_id, amount, reason, balance_after) VALUES (?, ?, ?, ?, ?)")
        .run(user.id, req.user.id, amount, reason, coins);
      return coins;
    });
    if (newBalance === null) {
      return res.status(400).json({ message: "หักคอยน์เกินยอดที่ผู้ใช้มีอยู่ไม่ได้" });
    }

    return res.json({
      message: amount > 0 ? `เพิ่ม ${amount} คอยน์สำเร็จ` : `หัก ${-amount} คอยน์สำเร็จ`,
      coins: newBalance,
    });
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
          `SELECT u.username, COALESCE(SUM(rs.read_seconds), 0) as totalSeconds
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

// GET คะแนนควิซแยกหมวด (subject/dog) สะสมทุกครั้งที่เคยตอบ ต่อผู้ใช้ 1 คน — ใช้หน้า "จัดการคะแนน"
router.get("/scores/quiz", requireAdmin, async (req, res, next) => {
  try {
    const rows = await db
      .prepare(
        `SELECT u.id, u.username, u.email,
                COALESCE(SUM(CASE WHEN qa.category = 'subject' THEN qa.correct ELSE 0 END), 0) AS subjectCorrect,
                COALESCE(SUM(CASE WHEN qa.category = 'subject' THEN 1 ELSE 0 END), 0) AS subjectTotal,
                COALESCE(SUM(CASE WHEN qa.category = 'dog' THEN qa.correct ELSE 0 END), 0) AS dogCorrect,
                COALESCE(SUM(CASE WHEN qa.category = 'dog' THEN 1 ELSE 0 END), 0) AS dogTotal,
                COALESCE(gr.coins, 0) AS gameBonusCoins,
                COALESCE(gr.stages, 0) AS gameStagesRewarded
         FROM users u
         LEFT JOIN quiz_answer_log qa ON qa.user_id = u.id
         LEFT JOIN (
           SELECT user_id, SUM(coins) AS coins, COUNT(*) AS stages FROM game_stage_rewards GROUP BY user_id
         ) gr ON gr.user_id = u.id
         WHERE u.is_admin = 0
         GROUP BY u.id
         ORDER BY u.username ASC`
      )
      .all();

    const pct = (correct, total) => (total > 0 ? Math.round((correct / total) * 100) : 0);
    const users = rows.map((r) => {
      const overallCorrect = r.subjectCorrect + r.dogCorrect;
      const overallTotal = r.subjectTotal + r.dogTotal;
      return {
        id: r.id,
        username: r.username,
        email: r.email,
        subjectPercent: pct(r.subjectCorrect, r.subjectTotal),
        subjectTotal: r.subjectTotal,
        dogPercent: pct(r.dogCorrect, r.dogTotal),
        dogTotal: r.dogTotal,
        overallPercent: pct(overallCorrect, overallTotal),
        overallTotal,
        gameBonusCoins: r.gameBonusCoins,
        gameStagesRewarded: r.gameStagesRewarded,
      };
    });

    return res.json({ users });
  } catch (err) {
    next(err);
  }
});

// ================== คะแนนแบบทดสอบก่อนอ่าน/หลังอ่าน (รายบท) ==================
// ใช้ชุดแรกของแต่ละบท (attempt 1 = มีทั้ง pre และ post) คิดคะแนนก่อน/หลัง (post = คะแนนครั้งแรก ก่อนทำซ้ำจนผ่าน)
// "ผ่าน" = post ดีที่สุดของบทนั้น ≥ 80%
const TEST_PASS_RATIO = 0.8;

function firstPostScore(t) {
  if (t.first_post_score !== null && t.first_post_score !== undefined) return t.first_post_score;
  return t.status === "completed" ? t.post_score : null;
}

function avgPct(list) {
  return list.length ? Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 10) / 10 : null;
}

function summarizeTests(tests) {
  const first = tests.filter((t) => t.attempt === 1 && t.total > 0);
  const pre = first.filter((t) => t.pre_score !== null).map((t) => (t.pre_score / t.total) * 100);
  const done = first.filter((t) => firstPostScore(t) !== null);
  const post = done.map((t) => (firstPostScore(t) / t.total) * 100);
  const gain = done.filter((t) => t.pre_score !== null).map((t) => ((firstPostScore(t) - t.pre_score) / t.total) * 100);
  return { preCount: pre.length, postCount: post.length, avgPrePct: avgPct(pre), avgPostPct: avgPct(post), avgGainPct: avgPct(gain) };
}

// บทที่ผ่านของแต่ละคน: Map(userId → Set(chapterId))
function passedChaptersByUser(tests) {
  const best = new Map();
  for (const t of tests) {
    if (t.status !== "completed") continue;
    const key = `${t.user_id}:${t.chapter_id}`;
    const ratio = t.total > 0 ? t.post_score / t.total : 1;
    best.set(key, Math.max(best.get(key) ?? 0, ratio));
  }
  const byUser = new Map();
  for (const [key, ratio] of best) {
    if (ratio < TEST_PASS_RATIO - 1e-9) continue;
    const [userId, chapterId] = key.split(":").map(Number);
    if (!byUser.has(userId)) byUser.set(userId, new Set());
    byUser.get(userId).add(chapterId);
  }
  return byUser;
}

// ---------- GET /api/admin/scores/tests ----------
// สรุปรายบท + รายคน (ผู้ใช้ทั่วไปเท่านั้น)
router.get("/scores/tests", requireAdmin, async (req, res, next) => {
  try {
    const [chapters, users, tests, streaks] = await Promise.all([
      db.prepare("SELECT id, chapter_number, title FROM chapters ORDER BY chapter_number ASC").all(),
      db.prepare("SELECT id, username, email FROM users WHERE is_admin = 0 ORDER BY username ASC").all(),
      db
        .prepare("SELECT * FROM chapter_tests WHERE user_id IN (SELECT id FROM users WHERE is_admin = 0)")
        .all(),
      getReadingStreaksForAll(),
    ]);
    const passed = passedChaptersByUser(tests);

    const chapterRows = chapters.map((c) => {
      const ct = tests.filter((t) => t.chapter_id === c.id);
      return {
        id: c.id,
        chapterNumber: c.chapter_number,
        title: c.title,
        ...summarizeTests(ct),
        passedCount: [...passed.values()].filter((set) => set.has(c.id)).length,
      };
    });

    const userRows = users.map((u) => {
      const ut = tests.filter((t) => t.user_id === u.id);
      const st = streaks.get(u.id);
      return {
        id: u.id,
        username: u.username,
        email: u.email,
        ...summarizeTests(ut),
        chaptersPassed: passed.has(u.id) ? passed.get(u.id).size : 0,
        currentStreak: st ? st.current : 0,
        lastReadDate: st ? st.lastReadDate : null,
      };
    });

    return res.json({ chapters: chapterRows, users: userRows, passPercent: TEST_PASS_RATIO * 100 });
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/admin/scores/tests/:userId ----------
// แบบทดสอบทุกชุดของผู้ใช้ 1 คน (รวมชุดที่อ่านซ้ำ) — ใช้ในหน้าต่างรายละเอียด
router.get("/scores/tests/:userId", requireAdmin, async (req, res, next) => {
  try {
    const tests = await db
      .prepare(
        `SELECT c.chapter_number AS chapterNumber, c.title, t.attempt, t.status, t.total,
                t.pre_score AS preScore, t.post_score AS postScore, t.first_post_score AS firstPostScore,
                t.post_tries AS postTries, t.coins_time AS coinsTime,
                t.coins_bonus AS coinsBonus, t.created_at AS createdAt, t.completed_at AS completedAt
         FROM chapter_tests t JOIN chapters c ON c.id = t.chapter_id
         WHERE t.user_id = ? ORDER BY c.chapter_number ASC, t.attempt ASC`
      )
      .all(Number(req.params.userId));
    return res.json({ tests });
  } catch (err) {
    next(err);
  }
});

// GET โบนัสคอยน์มินิเกมรายด่านของผู้ใช้ 1 คน (ได้ครั้งเดียวต่อด่าน เมื่อชนะด้วยคะแนน 80% ขึ้นไป) — ใช้ในหน้าต่างรายละเอียด
router.get("/scores/quiz/:userId/stages", requireAdmin, async (req, res, next) => {
  try {
    const stages = await db
      .prepare(
        `SELECT world, stage, coins, score_percent AS scorePercent, stars, rewarded_at AS rewardedAt
         FROM game_stage_rewards WHERE user_id = ? ORDER BY world ASC, stage ASC`
      )
      .all(Number(req.params.userId));
    return res.json({ stages });
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
// กติกาจริงของมินิเกม — ต้องตรงกับ BATTLE_MAX_QUESTIONS / BATTLE_PASS_RATIO ใน routes/game.js
const BATTLE_MAX_QUESTIONS = 30;
const BATTLE_PASS_RATIO = 0.8;

// GET รายการบท + เงื่อนไขเข้าเล่นของแต่ละบท พร้อมจำนวนข้อในคลังคำถาม (ที่เปิดใช้งาน)
router.get("/game-config", requireAdmin, async (req, res, next) => {
  try {
    const chapters = await db
      .prepare(
        `SELECT c.id, c.chapter_number, c.title, c.game_required_minutes, c.game_enabled,
                (SELECT COUNT(*) FROM quiz_questions q WHERE q.chapter_id = c.id AND q.enabled = 1) AS question_bank
         FROM chapters c ORDER BY c.chapter_number ASC`
      )
      .all();
    return res.json({
      chapters,
      battle: { maxQuestions: BATTLE_MAX_QUESTIONS, passRatio: BATTLE_PASS_RATIO },
    });
  } catch (err) {
    next(err);
  }
});

// PUT อัปเดตค่ามินิเกมของบทหนึ่งๆ (ไม่แตะฟิลด์อื่นของบท เช่น title/pdf_url)
router.put("/game-config/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const chapter = await db
      .prepare("SELECT id, game_required_minutes, game_enabled FROM chapters WHERE id = ?")
      .get(id);
    if (!chapter) return res.status(404).json({ message: "ไม่พบบทเรียนนี้" });

    const { requiredMinutes, enabled } = req.body;

    // validate เฉพาะฟิลด์ที่ส่งมา (ไม่บังคับส่งครบทุกฟิลด์)
    let newRequiredMinutes = chapter.game_required_minutes;
    if (requiredMinutes !== undefined) {
      const n = Number(requiredMinutes);
      if (!Number.isInteger(n) || n < 0 || n > 240) {
        return res.status(400).json({ message: "เวลาอ่านต้องเป็นจำนวนเต็ม 0-240 นาที" });
      }
      newRequiredMinutes = n;
    }

    let newEnabled = chapter.game_enabled;
    if (enabled !== undefined) {
      newEnabled = enabled ? 1 : 0;
    }

    await db
      .prepare("UPDATE chapters SET game_required_minutes = ?, game_enabled = ? WHERE id = ?")
      .run(newRequiredMinutes, newEnabled, id);

    const updated = await db
      .prepare(
        `SELECT c.id, c.chapter_number, c.title, c.game_required_minutes, c.game_enabled,
                (SELECT COUNT(*) FROM quiz_questions q WHERE q.chapter_id = c.id AND q.enabled = 1) AS question_bank
         FROM chapters c WHERE c.id = ?`
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
          `SELECT c.id, c.chapter_number, c.title, c.game_required_minutes, c.game_enabled, c.topics,
                (SELECT COUNT(*) FROM quiz_questions q WHERE q.chapter_id = c.id AND q.enabled = 1) AS question_bank
           FROM chapters c WHERE c.id = ?`
        )
        .get(chapterId),
      db
        .prepare(
          `SELECT id, chapter_id, level, question, option_1, option_2, option_3, option_4,
                  correct_option, enabled, created_at, topic
           FROM quiz_questions WHERE chapter_id = ? ORDER BY level ASC, id ASC`
        )
        .all(chapterId),
    ]);
    if (!chapter) return res.status(404).json({ message: "ไม่พบบทเรียนนี้" });

    // สถิติรายข้อ (ผู้ใช้ทั่วไป): ก่อนอ่าน / หลังอ่าน / ในเกม ตอบถูกกี่ % — หาข้อที่ง่ายหรือยากเกินไป
    const [testStats, gameStats] = await Promise.all([
      db
        .prepare(
          `SELECT q.question_id AS id,
                  SUM(CASE WHEN q.pre_picked IS NOT NULL THEN 1 ELSE 0 END) AS preAsked,
                  SUM(COALESCE(q.pre_correct, 0)) AS preCorrect,
                  SUM(CASE WHEN q.post_picked IS NOT NULL THEN 1 ELSE 0 END) AS postAsked,
                  SUM(COALESCE(q.post_correct, 0)) AS postCorrect
           FROM chapter_test_questions q
           JOIN chapter_tests t ON t.id = q.test_id
           JOIN users u ON u.id = t.user_id AND u.is_admin = 0
           JOIN quiz_questions qq ON qq.id = q.question_id AND qq.chapter_id = ?
           GROUP BY q.question_id`
        )
        .all(chapterId),
      db
        .prepare(
          `SELECT l.question_id AS id, COUNT(*) AS gameAsked, SUM(l.correct) AS gameCorrect
           FROM quiz_answer_log l
           JOIN users u ON u.id = l.user_id AND u.is_admin = 0
           JOIN quiz_questions qq ON qq.id = l.question_id AND qq.chapter_id = ?
           WHERE l.category = 'subject'
           GROUP BY l.question_id`
        )
        .all(chapterId),
    ]);
    const empty = { preAsked: 0, preCorrect: 0, postAsked: 0, postCorrect: 0, gameAsked: 0, gameCorrect: 0 };
    const withStats = questions.map((q) => ({
      ...q,
      stats: {
        ...empty,
        ...(testStats.find((s) => s.id === q.id) || {}),
        ...(gameStats.find((s) => s.id === q.id) || {}),
      },
    }));
    return res.json({ chapter, questions: withStats });
  } catch (err) {
    next(err);
  }
});

// ---- หัวข้อย่อยของบท (chapters.topics) ----
// เก็บเป็นข้อความบรรทัดละหัวข้อ ตัดบรรทัดว่างและหัวข้อซ้ำออกก่อนบันทึก
function parseTopics(raw) {
  const seen = new Set();
  return String(raw || "")
    .split("\n")
    .map((t) => t.trim().slice(0, 80))
    .filter((t) => t && !seen.has(t) && seen.add(t))
    .slice(0, 40);
}

router.put("/chapters/:id/topics", requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const chapter = await db.prepare("SELECT id FROM chapters WHERE id = ?").get(id);
    if (!chapter) return res.status(404).json({ message: "ไม่พบบทเรียนนี้" });

    const topics = parseTopics(req.body.topics);
    await db.prepare("UPDATE chapters SET topics = ? WHERE id = ?").run(topics.join("\n") || null, id);
    // หัวข้อที่ถูกลบออกจากรายการ: ปล่อยคำถามที่เคยผูกไว้ให้ว่าง จะได้ไม่เหลือหัวข้อที่ไม่มีอยู่จริง
    const placeholders = topics.map(() => "?").join(", ");
    await db
      .prepare(
        `UPDATE quiz_questions SET topic = NULL
         WHERE chapter_id = ? AND topic IS NOT NULL${topics.length ? ` AND topic NOT IN (${placeholders})` : ""}`
      )
      .run(id, ...topics);
    return res.json({ message: "บันทึกหัวข้อย่อยแล้ว", topics });
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
  // หัวข้อย่อยไม่บังคับ — ว่างไว้ได้ เก็บเป็น null เพื่อให้เช็กง่ายฝั่งที่เอาไปใช้
  const topic = String(body.topic || "").trim().slice(0, 80) || null;
  return { question: q, options, level, correct, topic };
}

router.post("/game-questions", requireAdmin, async (req, res) => {
  try {
    const chapterId = Number(req.body.chapterId);
    const chapter = await db.prepare("SELECT id, topics FROM chapters WHERE id = ?").get(chapterId);
    if (!chapter) return res.status(400).json({ message: "ไม่พบบทเรียนที่ระบุ" });

    const v = validateQuestionPayload(req.body);
    if (v.error) return res.status(400).json({ message: v.error });
    if (v.topic && !parseTopics(chapter.topics).includes(v.topic)) {
      return res.status(400).json({ message: "หัวข้อย่อยนี้ไม่มีในรายการหัวข้อของบทนี้" });
    }

    const result = await db
      .prepare(
        `INSERT INTO quiz_questions
         (chapter_id, level, question, option_1, option_2, option_3, option_4, correct_option, topic)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(chapterId, v.level, v.question, v.options[0], v.options[1], v.options[2], v.options[3], v.correct, v.topic);

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
    const existing = await db
      .prepare(
        `SELECT q.id, c.topics FROM quiz_questions q JOIN chapters c ON c.id = q.chapter_id WHERE q.id = ?`
      )
      .get(id);
    if (!existing) return res.status(404).json({ message: "ไม่พบคำถามนี้" });

    const v = validateQuestionPayload(req.body);
    if (v.error) return res.status(400).json({ message: v.error });
    if (v.topic && !parseTopics(existing.topics).includes(v.topic)) {
      return res.status(400).json({ message: "หัวข้อย่อยนี้ไม่มีในรายการหัวข้อของบทนี้" });
    }

    await db
      .prepare(
        `UPDATE quiz_questions
         SET level = ?, question = ?, option_1 = ?, option_2 = ?, option_3 = ?, option_4 = ?, correct_option = ?, topic = ?
         WHERE id = ?`
      )
      .run(v.level, v.question, v.options[0], v.options[1], v.options[2], v.options[3], v.correct, v.topic, id);

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

// ================== คำถามเกี่ยวกับพันธุ์สุนัข (breed_quiz_questions) ==================
// ใช้ในด่าน 2,4 ของทุกโลกในเกม แยกจาก quiz_questions ที่ผูกกับบทเรียน
const VALID_BREEDS = ["golden", "shiba", "siberian", "thairidgeback"];

router.get("/breed-questions", requireAdmin, async (req, res, next) => {
  try {
    const breed = req.query.breed;
    if (!breed || !VALID_BREEDS.includes(breed)) {
      return res.status(400).json({ message: "ระบุพันธุ์สุนัขให้ถูกต้อง (golden/shiba/siberian/thairidgeback)" });
    }
    const questions = await db
      .prepare(
        `SELECT id, breed, stage, question, option_1, option_2, option_3, option_4, correct_option, enabled, created_at
         FROM breed_quiz_questions WHERE breed = ? ORDER BY id ASC`
      )
      .all(breed);
    return res.json({ breed, questions });
  } catch (err) {
    next(err);
  }
});

// ใช้ validate เหมือน quiz_questions — แต่รับ breed + stage (2 หรือ 4) แทน level
const VALID_BREED_STAGES = [2, 4];

function validateBreedQuestionPayload(body) {
  const breed = body.breed;
  const stage = Number(body.stage);
  const q = String(body.question || "").trim();
  const options = [1, 2, 3, 4].map((i) => String(body["option_" + i] || "").trim());
  const correct = Number(body.correctOption);

  if (!VALID_BREEDS.includes(breed)) return { error: "พันธุ์สุนัขไม่ถูกต้อง" };
  if (!VALID_BREED_STAGES.includes(stage)) return { error: "ด่านต้องเป็น 2 หรือ 4 เท่านั้น" };
  if (!q) return { error: "กรุณากรอกคำถาม" };
  if (options.some((o) => !o)) return { error: "กรุณากรอกตัวเลือกให้ครบทั้ง 4 ข้อ" };
  if (!Number.isInteger(correct) || correct < 1 || correct > 4) {
    return { error: "ต้องเลือกคำตอบที่ถูก (1-4)" };
  }
  return { breed, stage, question: q, options, correct };
}

router.post("/breed-questions", requireAdmin, async (req, res) => {
  try {
    const v = validateBreedQuestionPayload(req.body);
    if (v.error) return res.status(400).json({ message: v.error });

    const result = await db
      .prepare(
        `INSERT INTO breed_quiz_questions
         (breed, stage, question, option_1, option_2, option_3, option_4, correct_option)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(v.breed, v.stage, v.question, v.options[0], v.options[1], v.options[2], v.options[3], v.correct);

    const created = await db
      .prepare("SELECT * FROM breed_quiz_questions WHERE id = ?")
      .get(result.lastInsertRowid);
    return res.status(201).json({ message: "เพิ่มคำถามสำเร็จ", question: created });
  } catch (err) {
    console.error("Create breed question error:", err);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์" });
  }
});

router.put("/breed-questions/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await db.prepare("SELECT id FROM breed_quiz_questions WHERE id = ?").get(id);
    if (!existing) return res.status(404).json({ message: "ไม่พบคำถามนี้" });

    const v = validateBreedQuestionPayload(req.body);
    if (v.error) return res.status(400).json({ message: v.error });

    await db
      .prepare(
        `UPDATE breed_quiz_questions
         SET breed = ?, stage = ?, question = ?, option_1 = ?, option_2 = ?, option_3 = ?, option_4 = ?, correct_option = ?
         WHERE id = ?`
      )
      .run(v.breed, v.stage, v.question, v.options[0], v.options[1], v.options[2], v.options[3], v.correct, id);

    const updated = await db.prepare("SELECT * FROM breed_quiz_questions WHERE id = ?").get(id);
    return res.json({ message: "อัปเดตคำถามสำเร็จ", question: updated });
  } catch (err) {
    console.error("Update breed question error:", err);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์" });
  }
});

router.patch("/breed-questions/:id/toggle", requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const q = await db.prepare("SELECT id, enabled FROM breed_quiz_questions WHERE id = ?").get(id);
    if (!q) return res.status(404).json({ message: "ไม่พบคำถามนี้" });
    const nextVal = q.enabled ? 0 : 1;
    await db.prepare("UPDATE breed_quiz_questions SET enabled = ? WHERE id = ?").run(nextVal, id);
    return res.json({ id: q.id, enabled: nextVal });
  } catch (err) {
    next(err);
  }
});

router.delete("/breed-questions/:id", requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await db.prepare("SELECT id FROM breed_quiz_questions WHERE id = ?").get(id);
    if (!existing) return res.status(404).json({ message: "ไม่พบคำถามนี้" });
    await db.prepare("DELETE FROM breed_quiz_questions WHERE id = ?").run(id);
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

// ================== การอ่านรายหน้า (PDF) — หลักฐานเสริมว่าอ่านจริง ==================
// GET /api/admin/reading-pages/:chapterId — เวลาที่เปิดแต่ละหน้าของบทนั้น รวมทุกรอบอ่าน แยกรายคน (ผู้ใช้ทั่วไปเท่านั้น)
// นับเฉพาะตอนจับเวลาอ่านอยู่และหน้าเว็บแสดงอยู่ (ดู reading_page_time ใน database.js) | หน้าที่เปิด ≥ 5 วินาที = เปิดอ่าน
const PAGE_VIEWED_MIN_SECONDS = 5;
router.get("/reading-pages/:chapterId", requireAdmin, async (req, res, next) => {
  try {
    const chapterId = Number(req.params.chapterId);
    const chapter = await db.prepare("SELECT id, chapter_number, title FROM chapters WHERE id = ?").get(chapterId);
    if (!chapter) return res.status(404).json({ message: "ไม่พบบทนี้" });

    const nonAdmin = "s.user_id IN (SELECT id FROM users WHERE is_admin = 0)";
    const [pageRows, totals, firstTests] = await Promise.all([
      db
        .prepare(
          `SELECT s.user_id AS userId, u.username, p.page, SUM(p.seconds) AS seconds
           FROM reading_page_time p
           JOIN reading_sessions s ON s.id = p.session_id
           JOIN users u ON u.id = s.user_id
           WHERE s.chapter_id = ? AND ${nonAdmin}
           GROUP BY s.user_id, p.page`
        )
        .all(chapterId),
      db
        .prepare(`SELECT MAX(s.pdf_total_pages) AS totalPages FROM reading_sessions s WHERE s.chapter_id = ? AND ${nonAdmin}`)
        .get(chapterId),
      db
        .prepare(
          `SELECT t.user_id AS userId, t.pre_score AS preScore, COALESCE(t.first_post_score, t.post_score) AS postScore, t.total
           FROM chapter_tests t
           WHERE t.chapter_id = ? AND t.attempt = 1 AND (t.first_post_score IS NOT NULL OR t.status = 'completed')
             AND t.user_id IN (SELECT id FROM users WHERE is_admin = 0)`
        )
        .all(chapterId),
    ]);

    const totalPages = totals.totalPages || pageRows.reduce((m, r) => Math.max(m, r.page), 0);
    const testByUser = new Map(firstTests.map((t) => [t.userId, t]));

    const users = new Map();
    for (const r of pageRows) {
      if (!users.has(r.userId)) users.set(r.userId, { id: r.userId, username: r.username, pages: {} });
      users.get(r.userId).pages[r.page] = r.seconds;
    }

    const pages = [];
    for (let page = 1; page <= totalPages; page++) {
      const viewed = [...users.values()].map((u) => u.pages[page] || 0).filter((sec) => sec >= PAGE_VIEWED_MIN_SECONDS);
      pages.push({
        page,
        readers: viewed.length,
        avgSeconds: viewed.length ? Math.round(viewed.reduce((a, b) => a + b, 0) / viewed.length) : 0,
      });
    }

    const userRows = [...users.values()]
      .map((u) => {
        const viewedPages = Object.entries(u.pages)
          .filter(([, sec]) => sec >= PAGE_VIEWED_MIN_SECONDS)
          .map(([page]) => Number(page));
        const test = testByUser.get(u.id);
        return {
          id: u.id,
          username: u.username,
          pagesViewed: viewedPages.length,
          coveragePct: totalPages ? Math.round((viewedPages.length / totalPages) * 100) : null,
          lastPage: viewedPages.length ? Math.max(...viewedPages) : null,
          minutes: Math.round((Object.values(u.pages).reduce((a, b) => a + b, 0) / 60) * 10) / 10,
          prePct: test && test.total ? Math.round((test.preScore / test.total) * 100) : null,
          postPct: test && test.total ? Math.round((test.postScore / test.total) * 100) : null,
          pages: u.pages,
        };
      })
      .sort((a, b) => b.pagesViewed - a.pagesViewed || b.minutes - a.minutes);

    return res.json({
      chapter: { id: chapter.id, chapterNumber: chapter.chapter_number, title: chapter.title, totalPages },
      viewedMinSeconds: PAGE_VIEWED_MIN_SECONDS,
      pages,
      users: userRows,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
