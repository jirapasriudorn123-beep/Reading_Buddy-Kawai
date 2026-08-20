const { createClient } = require("@libsql/client");

if (!process.env.TURSO_DATABASE_URL) {
  throw new Error("TURSO_DATABASE_URL is required");
}

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
  intMode: "number",
});

// ---------- wrapper API ให้หน้าตาคล้าย better-sqlite3 เดิม แต่ทุกเมธอดเป็น async ----------
// ทำให้ route files ที่มีอยู่แล้วเปลี่ยนน้อยที่สุด (แค่เติม await หน้า get/all/run)
function toRunResult(res) {
  return {
    changes: res.rowsAffected,
    lastInsertRowid: res.lastInsertRowid != null ? Number(res.lastInsertRowid) : undefined,
  };
}

function makeStatement(executor, sql) {
  return {
    get: async (...args) => {
      const res = await executor({ sql, args });
      return res.rows[0];
    },
    all: async (...args) => {
      const res = await executor({ sql, args });
      return res.rows;
    },
    run: async (...args) => {
      const res = await executor({ sql, args });
      return toRunResult(res);
    },
  };
}

const db = {
  prepare(sql) {
    return makeStatement((q) => client.execute(q), sql);
  },
  async exec(sql) {
    // libsql executeMultiple ใช้กับ multi-statement (คั่นด้วย ;)
    await client.executeMultiple(sql);
  },
  // ทดแทน better-sqlite3's db.transaction(fn)() ที่เป็น sync
  // เรียกใช้: await db.tx(async (t) => { await t.prepare(sql).run(...); ... })
  async tx(callback) {
    const tx = await client.transaction("write");
    try {
      const txDb = {
        prepare: (sql) => makeStatement((q) => tx.execute(q), sql),
      };
      const result = await callback(txDb);
      await tx.commit();
      return result;
    } catch (err) {
      try {
        await tx.rollback();
      } catch (_) {
        // ignore rollback error
      }
      throw err;
    }
  },
  // batch หลายคำสั่งแบบ atomic (สำหรับ seed / bulk insert)
  async batch(statements) {
    return client.batch(statements, "write");
  },
};

// ---------- สร้าง/อัปเดต schema (เรียกครั้งเดียวตอน server เริ่ม) ----------
async function initDatabase() {
  await client.execute("PRAGMA foreign_keys = ON");

  // ---- ตาราง users ----
  await client.execute(`
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

  // เผื่อฐานข้อมูลเก่าที่สร้างไว้ก่อนมีฟีเจอร์เหล่านี้ ให้เพิ่มคอลัมน์แบบปลอดภัย
  const userColumns = (await client.execute("PRAGMA table_info(users)")).rows.map((c) => c.name);
  const STARTING_COINS = 100;
  const userColumnMigrations = [
    ["reset_token_hash", "ALTER TABLE users ADD COLUMN reset_token_hash TEXT"],
    ["reset_token_expires", "ALTER TABLE users ADD COLUMN reset_token_expires TEXT"],
    ["coins", `ALTER TABLE users ADD COLUMN coins INTEGER NOT NULL DEFAULT ${STARTING_COINS}`],
    ["avatar_url", "ALTER TABLE users ADD COLUMN avatar_url TEXT"],
    ["is_admin", "ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0"],
    ["last_active_at", "ALTER TABLE users ADD COLUMN last_active_at TEXT"],
    ["last_seen_update_at", "ALTER TABLE users ADD COLUMN last_seen_update_at TEXT"],
  ];
  for (const [col, sql] of userColumnMigrations) {
    if (!userColumns.includes(col)) await client.execute(sql);
  }

  // ---- ตารางเป้าหมายเวลาอ่าน (1 แถวต่อผู้ใช้ 1 คน) ----
  await client.execute(`
    CREATE TABLE IF NOT EXISTS reading_goals (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      goal_minutes INTEGER NOT NULL DEFAULT 0,
      goal_seconds INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // ---- ตาราง chapters ----
  await client.execute(`
    CREATE TABLE IF NOT EXISTS chapters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chapter_number INTEGER NOT NULL UNIQUE,
      title TEXT NOT NULL,
      coin_reward INTEGER NOT NULL DEFAULT 20
    )
  `);

  const chapterColumns = (await client.execute("PRAGMA table_info(chapters)")).rows.map((c) => c.name);
  const chapterColumnMigrations = [
    ["detail", "ALTER TABLE chapters ADD COLUMN detail TEXT"],
    ["image_url", "ALTER TABLE chapters ADD COLUMN image_url TEXT"],
    ["pdf_url", "ALTER TABLE chapters ADD COLUMN pdf_url TEXT"],
    // ค่าที่แอดมินตั้งในหน้า "จัดการมินิเกม" สำหรับแต่ละบท
    // required_minutes = ต้องอ่านครบกี่นาทีถึงจะเล่นมินิเกมของบทนี้ได้
    // question_count = จำนวนข้อคำถามในมินิเกม
    // enabled = เปิดใช้งานมินิเกมบทนี้หรือไม่ (0/1)
    ["game_required_minutes", "ALTER TABLE chapters ADD COLUMN game_required_minutes INTEGER NOT NULL DEFAULT 20"],
    ["game_question_count", "ALTER TABLE chapters ADD COLUMN game_question_count INTEGER NOT NULL DEFAULT 5"],
    ["game_enabled", "ALTER TABLE chapters ADD COLUMN game_enabled INTEGER NOT NULL DEFAULT 1"],
  ];
  for (const [col, sql] of chapterColumnMigrations) {
    if (!chapterColumns.includes(col)) await client.execute(sql);
  }

  const chapterCountRes = await client.execute("SELECT COUNT(*) AS count FROM chapters");
  if (Number(chapterCountRes.rows[0].count) === 0) {
    const seedChapters = [
      [1, "ระบบเลขฐาน", 20],
      [2, "ขั้นตอนการคิดและการแก้ปัญหาเชิงตรรกะ", 20],
      [3, "ตรรกะพื้นฐาน", 20],
      [4, "อัลกอริทึม", 20],
      [5, "รูปแบบการพัฒนาโปรแกรม", 20],
      [6, "พื้นฐานการเขียนโปรแกรมและการนำไปใช้", 20],
    ];
    await client.batch(
      seedChapters.map(([n, t, r]) => ({
        sql: "INSERT INTO chapters (chapter_number, title, coin_reward) VALUES (?, ?, ?)",
        args: [n, t, r],
      })),
      "write"
    );
  }

  // ---- ตารางบันทึกเซสชันการอ่านแต่ละครั้ง ----
  await client.execute(`
    CREATE TABLE IF NOT EXISTS reading_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
      planned_read_seconds INTEGER NOT NULL,
      planned_break_seconds INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'in_progress',
      coins_earned INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT
    )
  `);

  // ---- ตาราง pets ----
  await client.execute(`
    CREATE TABLE IF NOT EXISTS pets (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      breed TEXT NOT NULL,
      name TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      exp INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const petColumns = (await client.execute("PRAGMA table_info(pets)")).rows.map((c) => c.name);
  const petColumnMigrations = [
    ["hunger", "ALTER TABLE pets ADD COLUMN hunger INTEGER NOT NULL DEFAULT 100"],
    ["cleanliness", "ALTER TABLE pets ADD COLUMN cleanliness INTEGER NOT NULL DEFAULT 100"],
    ["happiness", "ALTER TABLE pets ADD COLUMN happiness INTEGER NOT NULL DEFAULT 100"],
    ["energy", "ALTER TABLE pets ADD COLUMN energy INTEGER NOT NULL DEFAULT 100"],
    ["growth_stage", "ALTER TABLE pets ADD COLUMN growth_stage TEXT NOT NULL DEFAULT 'baby'"],
    ["care_points", "ALTER TABLE pets ADD COLUMN care_points INTEGER NOT NULL DEFAULT 0"],
    ["level_progress", "ALTER TABLE pets ADD COLUMN level_progress INTEGER NOT NULL DEFAULT 0"],
    ["stats_updated_at", "ALTER TABLE pets ADD COLUMN stats_updated_at TEXT"],
    ["hunger_updated_at", "ALTER TABLE pets ADD COLUMN hunger_updated_at TEXT"],
    ["cleanliness_updated_at", "ALTER TABLE pets ADD COLUMN cleanliness_updated_at TEXT"],
    ["happiness_updated_at", "ALTER TABLE pets ADD COLUMN happiness_updated_at TEXT"],
    ["energy_updated_at", "ALTER TABLE pets ADD COLUMN energy_updated_at TEXT"],
  ];
  for (const [col, sql] of petColumnMigrations) {
    if (!petColumns.includes(col)) await client.execute(sql);
  }

  // backfill timestamp ให้แถวเก่า
  await client.execute(`
    UPDATE pets SET
      stats_updated_at = COALESCE(stats_updated_at, datetime('now')),
      hunger_updated_at = COALESCE(hunger_updated_at, stats_updated_at, datetime('now')),
      cleanliness_updated_at = COALESCE(cleanliness_updated_at, stats_updated_at, datetime('now')),
      happiness_updated_at = COALESCE(happiness_updated_at, stats_updated_at, datetime('now')),
      energy_updated_at = COALESCE(energy_updated_at, stats_updated_at, datetime('now'))
    WHERE hunger_updated_at IS NULL OR cleanliness_updated_at IS NULL
       OR happiness_updated_at IS NULL OR energy_updated_at IS NULL
  `);

  // ---- ตาราง products ----
  await client.execute(`
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

  const productCountRes = await client.execute("SELECT COUNT(*) AS count FROM products");
  if (Number(productCountRes.rows[0].count) === 0) {
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
      ["bone-discount", "กระดูกปลอม", 5, "bone.png", "คูปอง", "ราคาพิเศษ! กระดูกช่วยขัดฟัน", null],
    ];
    await client.batch(
      seedProducts.map((row) => ({
        sql: "INSERT INTO products (id, name, price, img, category, description, tag) VALUES (?, ?, ?, ?, ?, ?, ?)",
        args: row,
      })),
      "write"
    );
  }

  const productColumns = (await client.execute("PRAGMA table_info(products)")).rows.map((c) => c.name);
  const isFirstProductMigration = !productColumns.includes("pet_action");
  if (!productColumns.includes("pet_action")) {
    await client.execute("ALTER TABLE products ADD COLUMN pet_action TEXT");
  }
  if (!productColumns.includes("stat_gain")) {
    await client.execute("ALTER TABLE products ADD COLUMN stat_gain INTEGER NOT NULL DEFAULT 0");
  }
  // ใช้กับคูปอง: ต้องอ่านสะสมกี่นาทีถึงจะแลกได้ (0 = ไม่ต้องอ่านสะสม ใช้เฉพาะการซื้อของทั่วไป)
  if (!productColumns.includes("required_reading_minutes")) {
    await client.execute("ALTER TABLE products ADD COLUMN required_reading_minutes INTEGER NOT NULL DEFAULT 0");
  }

  if (isFirstProductMigration) {
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
      ["bone-discount", "bath", 5],
    ];
    await client.batch(
      defaults.map(([id, action, gain]) => ({
        sql: "UPDATE products SET pet_action = ?, stat_gain = ? WHERE id = ?",
        args: [action, gain, id],
      })),
      "write"
    );
  }

  // ---- ตาราง inventory ----
  await client.execute(`
    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      count INTEGER NOT NULL DEFAULT 1,
      UNIQUE(user_id, product_id)
    )
  `);

  // ---- ตาราง game_progress ----
  await client.execute(`
    CREATE TABLE IF NOT EXISTS game_progress (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      unlocked_world INTEGER NOT NULL DEFAULT 1,
      unlocked_stage INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // ---- ตาราง purchase_log ----
  await client.execute(`
    CREATE TABLE IF NOT EXISTS purchase_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_name TEXT NOT NULL,
      price INTEGER NOT NULL,
      purchased_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // ---- ตาราง quiz_questions (คำถามในมินิเกมแต่ละบท ที่แอดมินสร้างเอง) ----
  // level = ระดับความยาก 1,2,3... (ใช้จัดกลุ่มในหน้าจัดการเกม)
  // correct_option = 1-4 ชี้ไปที่ option_1..option_4
  await client.execute(`
    CREATE TABLE IF NOT EXISTS quiz_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
      level INTEGER NOT NULL DEFAULT 1,
      question TEXT NOT NULL,
      option_1 TEXT NOT NULL,
      option_2 TEXT NOT NULL,
      option_3 TEXT NOT NULL,
      option_4 TEXT NOT NULL,
      correct_option INTEGER NOT NULL CHECK(correct_option BETWEEN 1 AND 4),
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // ---- ตาราง breed_quiz_questions (คำถามในด่านที่เกี่ยวกับพันธุ์สุนัข ด่าน 2,4 ในเกม) ----
  // breed = golden / shiba / siberian / thairidgeback ต้องตรงกับ PLAYER_BREEDS ใน game.js
  // stage = 2 หรือ 4 (ด่านไหนของโลกที่คำถามนี้อยู่ในหมวด) — ใช้จัดกลุ่มในหน้าแอดมินเท่านั้น
  await client.execute(`
    CREATE TABLE IF NOT EXISTS breed_quiz_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      breed TEXT NOT NULL,
      stage INTEGER NOT NULL DEFAULT 2,
      question TEXT NOT NULL,
      option_1 TEXT NOT NULL,
      option_2 TEXT NOT NULL,
      option_3 TEXT NOT NULL,
      option_4 TEXT NOT NULL,
      correct_option INTEGER NOT NULL CHECK(correct_option BETWEEN 1 AND 4),
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // เผื่อฐานข้อมูลเก่าที่สร้างตารางนี้ไว้ก่อนมีคอลัมน์ stage
  const breedQuizColumns = (await client.execute("PRAGMA table_info(breed_quiz_questions)")).rows.map((c) => c.name);
  if (!breedQuizColumns.includes("stage")) {
    await client.execute("ALTER TABLE breed_quiz_questions ADD COLUMN stage INTEGER NOT NULL DEFAULT 2");
  }

  // ---- ตาราง quiz_answer_log (log ทุกครั้งที่ผู้เล่นตอบคำถามในมินิเกม ใช้คิด % คะแนนแยกตามหมวดที่หน้า "จัดการคะแนน") ----
  // category: 'subject' = ด่าน 1,3,5 (คำถามวิชา) | 'dog' = ด่าน 2,4 (คำถามพันธุ์สุนัข)
  // % คะแนนของผู้ใช้แต่ละคนคิดสะสมจากทุกครั้งที่เคยตอบ (ไม่ใช่แค่รอบล่าสุด) ยิ่งเล่นซ้ำยิ่งนับสะสมเพิ่ม
  await client.execute(`
    CREATE TABLE IF NOT EXISTS quiz_answer_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category TEXT NOT NULL CHECK(category IN ('subject', 'dog')),
      correct INTEGER NOT NULL CHECK(correct IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // ---- ตาราง chat_answers ----
  await client.execute(`
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

  // ---- ตาราง chat_history ----
await client.execute(`
  CREATE TABLE IF NOT EXISTS chat_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

  // ---- ตาราง site_meta ----
  await client.execute(`
    CREATE TABLE IF NOT EXISTS site_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);
  const metaCountRes = await client.execute("SELECT COUNT(*) AS count FROM site_meta");
  if (Number(metaCountRes.rows[0].count) === 0) {
    await client.batch(
      [
        {
          sql: "INSERT INTO site_meta (key, value) VALUES (?, ?)",
          args: ["latest_update_message", "เว็บมีการอัปเดตใหม่ล่าสุด! มาดูของใหม่กันเถอะ"],
        },
        {
          sql: "INSERT INTO site_meta (key, value) VALUES (?, ?)",
          args: ["latest_update_at", new Date().toISOString().slice(0, 19).replace("T", " ")],
        },
      ],
      "write"
    );
  }
}

db.init = initDatabase;

module.exports = db;
