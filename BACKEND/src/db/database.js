const path = require("path");
const Database = require("better-sqlite3");

// ไฟล์ฐานข้อมูล SQLite จะถูกสร้างที่ backend/src/db/database.db อัตโนมัติ
const dbPath = path.join(__dirname, "database.db");
const db = new Database(dbPath);

// เปิดใช้ foreign key constraint
db.pragma("foreign_keys = ON");

// สร้างตาราง users ถ้ายังไม่มี
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    reset_token_hash TEXT,
    reset_token_expires TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// เผื่อฐานข้อมูลเก่าที่สร้างไว้ก่อนมีฟีเจอร์ reset password ให้เพิ่มคอลัมน์ที่ขาดแบบปลอดภัย
const userColumns = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
if (!userColumns.includes("reset_token_hash")) {
  db.exec("ALTER TABLE users ADD COLUMN reset_token_hash TEXT");
}
if (!userColumns.includes("reset_token_expires")) {
  db.exec("ALTER TABLE users ADD COLUMN reset_token_expires TEXT");
}
// เหรียญเริ่มต้นของผู้ใช้ใหม่ทุกคน (ปรับได้ตามต้องการ)
const STARTING_COINS = 100;
if (!userColumns.includes("coins")) {
  db.exec(`ALTER TABLE users ADD COLUMN coins INTEGER NOT NULL DEFAULT ${STARTING_COINS}`);
}
if (!userColumns.includes("avatar_url")) {
  db.exec("ALTER TABLE users ADD COLUMN avatar_url TEXT");
}
// สิทธิ์แอดมิน (0 = ผู้ใช้ทั่วไป, 1 = แอดมิน) ใช้ users ตารางเดียวกัน ไม่แยกตารางใหม่เพื่อความง่าย
if (!userColumns.includes("is_admin")) {
  db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0");
}
// เวลาที่ผู้ใช้เรียก API ล่าสุด (ใช้คำนวณ "ผู้ใช้ที่ออนไลน์ขณะนี้" ในแดชบอร์ดแอดมิน) อัปเดตจาก requireAuth middleware
if (!userColumns.includes("last_active_at")) {
  db.exec("ALTER TABLE users ADD COLUMN last_active_at TEXT");
}
// เวลาที่ผู้ใช้เห็นประกาศอัปเดตเว็บล่าสุดแล้ว (ใช้เทียบกับ site_meta.latest_update_at ว่ามีอัปเดตใหม่ที่ยังไม่เห็นไหม)
if (!userColumns.includes("last_seen_update_at")) {
  db.exec("ALTER TABLE users ADD COLUMN last_seen_update_at TEXT");
}

// ---- ตารางเป้าหมายเวลาอ่าน (1 แถวต่อผู้ใช้ 1 คน) ----
db.exec(`
  CREATE TABLE IF NOT EXISTS reading_goals (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    goal_minutes INTEGER NOT NULL DEFAULT 0,
    goal_seconds INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// ---- ตาราง chapters (เนื้อหาบทเรียน) ----
db.exec(`
  CREATE TABLE IF NOT EXISTS chapters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chapter_number INTEGER NOT NULL UNIQUE,
    title TEXT NOT NULL,
    coin_reward INTEGER NOT NULL DEFAULT 20
  )
`);

// เผื่อตาราง chapters เก่าที่สร้างไว้ก่อนมีฟีเจอร์จัดการบทเรียนฝั่งแอดมิน (รายละเอียด + รูปปก + ไฟล์ PDF)
{
  const chapterColumns = db.prepare("PRAGMA table_info(chapters)").all().map((c) => c.name);
  if (!chapterColumns.includes("detail")) {
    db.exec("ALTER TABLE chapters ADD COLUMN detail TEXT");
  }
  if (!chapterColumns.includes("image_url")) {
    db.exec("ALTER TABLE chapters ADD COLUMN image_url TEXT");
  }
  if (!chapterColumns.includes("pdf_url")) {
    db.exec("ALTER TABLE chapters ADD COLUMN pdf_url TEXT");
  }
}

// seed ข้อมูล chapter เริ่มต้นจากหน้า index.html (ใส่แค่ครั้งแรกที่ตารางว่าง)
const chapterCount = db.prepare("SELECT COUNT(*) AS count FROM chapters").get().count;
if (chapterCount === 0) {
  const insertChapter = db.prepare(
    "INSERT INTO chapters (chapter_number, title, coin_reward) VALUES (?, ?, ?)"
  );
  const seedChapters = [
    [1, "ระบบเลขฐาน", 20],
    [2, "ขั้นตอนการคิดและการแก้ปัญหาเชิงตรรกะ", 20],
    [3, "ตรรกะพื้นฐาน", 20],
    [4, "อัลกอริทึม", 20],
    [5, "รูปแบบการพัฒนาโปรแกรม", 20],
    [6, "พื้นฐานการเขียนโปรแกรมและการนำไปใช้", 20],
  ];
  const insertMany = db.transaction((rows) => {
    for (const row of rows) insertChapter.run(...row);
  });
  insertMany(seedChapters);
}

// ---- ตารางบันทึกเซสชันการอ่านแต่ละครั้ง ----
db.exec(`
  CREATE TABLE IF NOT EXISTS reading_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    planned_read_seconds INTEGER NOT NULL,
    planned_break_seconds INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'in_progress', -- in_progress | completed | cancelled
    coins_earned INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT
  )
`);
// ---- ตาราง pets (สัตว์เลี้ยงของผู้ใช้ 1 คนต่อ 1 ตัว) ----
// เดิมใช้ level/exp แบบเกม RPG แต่เปลี่ยนมาใช้ระบบสถานะ 4 อย่าง (หิว/สะอาด/ความสุข/พลังงาน) ที่ลดลงตามเวลาจริงแทน
db.exec(`
  CREATE TABLE IF NOT EXISTS pets (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    breed TEXT NOT NULL,
    name TEXT NOT NULL,
    level INTEGER NOT NULL DEFAULT 1,
    exp INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// migrate: เพิ่มคอลัมน์สถานะ 4 อย่าง + ระบบเติบโตให้ตาราง pets ที่อาจเคยสร้างไว้ก่อนหน้านี้แล้ว
// (CREATE TABLE IF NOT EXISTS ด้านบนจะไม่ทำอะไรถ้าตารางมีอยู่แล้ว เลยต้อง ALTER TABLE เพิ่มเอง)
{
  const petColumns = db.prepare("PRAGMA table_info(pets)").all().map((c) => c.name);
  const addPetColumn = (name, ddl) => {
    if (!petColumns.includes(name)) {
      db.exec(`ALTER TABLE pets ADD COLUMN ${ddl}`);
    }
  };

  addPetColumn("hunger", "hunger INTEGER NOT NULL DEFAULT 100");
  addPetColumn("cleanliness", "cleanliness INTEGER NOT NULL DEFAULT 100");
  addPetColumn("happiness", "happiness INTEGER NOT NULL DEFAULT 100");
  addPetColumn("energy", "energy INTEGER NOT NULL DEFAULT 100");
  addPetColumn("growth_stage", "growth_stage TEXT NOT NULL DEFAULT 'baby'");
  addPetColumn("care_points", "care_points INTEGER NOT NULL DEFAULT 0");
  // แต้มสะสมภายในเลเวลปัจจุบัน (0 ถึง LEVEL_XP_TARGET-1 ใน routes/pet.js) เพิ่มตามเปอร์เซ็นต์ของไอเทมที่ให้จริง ไม่ใช่ +1 ตายตัวต่อครั้งเหมือนเดิม
  addPetColumn("level_progress", "level_progress INTEGER NOT NULL DEFAULT 0");
  addPetColumn("stats_updated_at", "stats_updated_at TEXT"); // เก็บไว้เฉยๆ ไม่ใช้แล้ว (ของเก่าก่อนแยก timestamp ต่อสถานะ)

  // แยก timestamp ต่อสถานะ เพราะแต่ละสถานะลดเร็วช้าไม่เท่ากัน (ดูค่า DECAY_MINUTES_PER_POINT ใน routes/pet.js)
  // ถ้าใช้ timestamp ตัวเดียวร่วมกัน สถานะที่ลดเร็วจะรีเซ็ตนาฬิกาบ่อยจนสถานะที่ลดช้ากว่าแทบไม่ลดเลย
  addPetColumn("hunger_updated_at", "hunger_updated_at TEXT");
  addPetColumn("cleanliness_updated_at", "cleanliness_updated_at TEXT");
  addPetColumn("happiness_updated_at", "happiness_updated_at TEXT");
  addPetColumn("energy_updated_at", "energy_updated_at TEXT");

  // backfill ให้แถวเก่า (ใส่ default เป็นฟังก์ชันตรงๆ ใน ADD COLUMN ไม่ได้ เลย backfill แยกอีกที)
  db.exec(`
    UPDATE pets SET
      stats_updated_at = COALESCE(stats_updated_at, datetime('now')),
      hunger_updated_at = COALESCE(hunger_updated_at, stats_updated_at, datetime('now')),
      cleanliness_updated_at = COALESCE(cleanliness_updated_at, stats_updated_at, datetime('now')),
      happiness_updated_at = COALESCE(happiness_updated_at, stats_updated_at, datetime('now')),
      energy_updated_at = COALESCE(energy_updated_at, stats_updated_at, datetime('now'))
    WHERE hunger_updated_at IS NULL OR cleanliness_updated_at IS NULL
       OR happiness_updated_at IS NULL OR energy_updated_at IS NULL
  `);
}

// ---- ตาราง products (แคตตาล็อกสินค้าในร้านค้า) ----
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    price INTEGER NOT NULL,
    img TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    tag TEXT
  )
`);
 
// seed สินค้าเริ่มต้นจาก script.js เดิม (ใส่แค่ครั้งแรกที่ตารางว่าง)
const productCount = db.prepare("SELECT COUNT(*) AS count FROM products").get().count;
if (productCount === 0) {
  const insertProduct = db.prepare(
    "INSERT INTO products (id, name, price, img, category, description, tag) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  const seedProducts = [
    ["cucumber", "แตงกวา", 10, "cucumber.png", "อาหาร", "ผักสดกรอบ ช่วยเพิ่มวิตามินให้น้องหมา", null],
    ["asparagus", "หน่อไม้ฝรั่ง", 10, "asparagus.png", "อาหาร", "หน่อไม้ฝรั่งคัดเกรด ไฟเบอร์สูง", null],
    ["carrot", "แครอท", 10, "carrot.png", "อาหาร", "บำรุงสายตาและขนให้นุ่มลื่น", null],
    ["salmon", "ปลาแซลมอน", 10, "salmon.png", "อาหาร", "ปลาแซลมอนอุดมไปด้วยกรดไขมันโอเมก้า 3 เป็นแหล่งโปรตีนที่ดีช่วยเสริมให้ผิวหนังและเส้นขนของสุนัขแข็งแรง", null],
    ["egg", "ไข่ต้ม", 10, "egg.png", "อาหาร", "โปรตีนเน้น ๆ เสริมสร้างกล้ามเนื้อ", null],
    ["corn", "ข้าวโพด", 10, "corn.png", "อาหาร", "คาร์โบไฮเดรตดี เพิ่มพลังงาน", null],
    ["beef", "เนื้อ", 10, "beef.png", "อาหาร", "โปรตีน", null],
    ["ball", "ลูกบอลยาง", 20, "ball.png", "ของเล่น", "บอลยางเด้งดึ๋ง ทนทานต่อการกัด", null],
    ["rope", "เชือกถัก", 15, "rope.png", "ของเล่น", "เชือกขัดฟัน ช่วยลดคราบหินปูน", null],
    ["hoodie", "เสื้อฮู้ด", 50, "hoodie.png", "เสื้อผ้า", "เสื้อผ้าเนื้อนุ่ม ใส่สบาย ไม่ร้อน", null],
    ["hat", "หมวกแก๊ป", 30, "hat.png", "เสื้อผ้า", "หมวกสุดเท่ กันแดดเวลาออกไปเที่ยว", null],
    ["friend-dog", "ตุ๊กตาเพื่อนเล่น", 100, "mini-dog.png", "สัตว์เลี้ยง", "ตุ๊กตาจำลองเป็นเพื่อนแก้เหงาให้น้อง", null],
    ["bone-discount", "กระดูกปลอม", 5, "bone.png", "ส่วนลด", "ราคาพิเศษ! กระดูกช่วยขัดฟัน", null],
  ];
  const insertMany = db.transaction((rows) => {
    for (const row of rows) insertProduct.run(...row);
  });
  insertMany(seedProducts);
}
 
// เผื่อตาราง products เก่าที่สร้างไว้ก่อนมีฟีเจอร์ "ใช้ไอเทมกับน้องหมา"
// pet_action = ใช้แล้วเติมสถานะไหนของน้องหมา (feed/bath/happiness/sleep) NULL = เป็นของสะสม ใช้กับน้องไม่ได้
// stat_gain  = ใช้แล้วสถานะนั้นเพิ่มกี่เปอร์เซ็นต์
{
  const productColumns = db.prepare("PRAGMA table_info(products)").all().map((c) => c.name);
  const isFirstMigration = !productColumns.includes("pet_action");

  if (!productColumns.includes("pet_action")) {
    db.exec("ALTER TABLE products ADD COLUMN pet_action TEXT");
  }
  if (!productColumns.includes("stat_gain")) {
    db.exec("ALTER TABLE products ADD COLUMN stat_gain INTEGER NOT NULL DEFAULT 0");
  }

  // ตั้งค่าเริ่มต้นให้สินค้าชุดแรกที่ seed ไว้ (ทำครั้งเดียวตอน migrate ครั้งแรกเท่านั้น
  // ถ้าแอดมินแก้ค่าเองทีหลังจะไม่ถูกเขียนทับ)
  if (isFirstMigration) {
    const setPetUse = db.prepare("UPDATE products SET pet_action = ?, stat_gain = ? WHERE id = ?");
    const defaults = [
      ["cucumber", "feed", 6],
      ["asparagus", "feed", 6],
      ["carrot", "feed", 8],
      ["salmon", "feed", 15],
      ["egg", "feed", 10],
      ["corn", "feed", 8],
      ["beef", "feed", 15],
      ["ball", "happiness", 12],
      ["rope", "happiness", 10],
      ["hoodie", "happiness", 20],
      ["hat", "happiness", 15],
      ["friend-dog", "happiness", 25],
      ["bone-discount", "bath", 5], // กระดูกขัดฟัน = ทำความสะอาด (ตาม description เดิมในร้าน)
    ];
    const applyDefaults = db.transaction((rows) => {
      for (const [id, action, gain] of rows) setPetUse.run(action, gain, id);
    });
    applyDefaults(defaults);
  }
}

// ---- ตาราง inventory (ของที่ผู้ใช้ซื้อไปแล้ว) ----
db.exec(`
  CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    count INTEGER NOT NULL DEFAULT 1,
    UNIQUE(user_id, product_id)
  )
`);

// ---- ตาราง game_progress (ความคืบหน้าด่านของเกม Phayao Adventure ต่อผู้ใช้ 1 คน) ----
// เก็บแค่ "จุดปลดล็อคไกลสุด" (world/stage ล่าสุดที่ไปถึง) ด่าน/เวิลด์ก่อนหน้าจุดนี้ถือว่าปลดล็อคแล้วทั้งหมด
db.exec(`
  CREATE TABLE IF NOT EXISTS game_progress (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    unlocked_world INTEGER NOT NULL DEFAULT 1,
    unlocked_stage INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// ---- ตาราง purchase_log (ประวัติการซื้อแต่ละครั้ง แยกจาก inventory เพราะ inventory เก็บแค่ยอดรวม ไม่มีเวลา) ----
db.exec(`
  CREATE TABLE IF NOT EXISTS purchase_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_name TEXT NOT NULL,
    price INTEGER NOT NULL,
    purchased_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// ---- ตาราง chat_answers (คลังคำถาม-คำตอบของแชทบอทน้องหมา ให้แอดมินหลายคนช่วยกันเพิ่มได้จากหน้าเว็บ) ----
// keywords = คำสำคัญที่ชี้มาคำตอบนี้ คั่นด้วยจุลภาค (เช่น "ฐานสอง,binary,แปลงเลขฐาน")
// chapter_id = ผูกกับบทเรียนไหน (NULL = คำตอบกลาง ไม่ผูกบทใดบทหนึ่ง) ใช้จัดหมวดในหน้าแอดมิน และใช้ตัดสินตอนคำตอบชนกัน
db.exec(`
  CREATE TABLE IF NOT EXISTS chat_answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chapter_id INTEGER REFERENCES chapters(id) ON DELETE CASCADE,
    keywords TEXT NOT NULL,
    answer TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// ---- ตาราง site_meta (key-value เก็บข้อความ/เวลาของอัปเดตเว็บล่าสุด ใช้ทำแจ้งเตือน "มีอัปเดตใหม่") ----
db.exec(`
  CREATE TABLE IF NOT EXISTS site_meta (
    key TEXT PRIMARY KEY,
    value TEXT
  )
`);
{
  const metaCount = db.prepare("SELECT COUNT(*) AS count FROM site_meta").get().count;
  if (metaCount === 0) {
    const insertMeta = db.prepare("INSERT INTO site_meta (key, value) VALUES (?, ?)");
    insertMeta.run("latest_update_message", "เว็บมีการอัปเดตใหม่ล่าสุด! มาดูของใหม่กันเถอะ");
    insertMeta.run("latest_update_at", new Date().toISOString().slice(0, 19).replace("T", " "));
  }
}

module.exports = db;
