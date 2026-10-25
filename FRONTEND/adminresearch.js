// ================== ข้อมูลวิจัย (ส่วนหนึ่งของหน้าหลักแอดมิน) ==================
// ดูข้อมูลชุดเดียวกับไฟล์ CSV เป็นตารางในเว็บ
// แท็บด้านบน = หมวดข้อมูล | ตารางแบ่งหน้าในกรอบ | ปุ่มดาวน์โหลด CSV ของหมวดที่เปิดอยู่
// ข้อมูลจาก GET /api/admin/export/:kind/data — คอลัมน์/ความหมายดูที่ BACKEND/src/services/researchExport.js

const RS_DATASETS = [
  { kind: "users", label: "รายคน", desc: "1 แถว = ผู้ใช้ 1 คน (สรุปตลอดการใช้งาน)" },
  { kind: "days", label: "รายวัน", desc: "1 แถว = ผู้ใช้ 1 คน × 1 วันที่เข้าใช้" },
  { kind: "sessions", label: "รายรอบอ่าน", desc: "1 แถว = รอบอ่าน 1 รอบ" },
  { kind: "reviews", label: "การทบทวน", desc: "1 แถว = ตอบคำถามบทเรียน 1 ครั้ง (แบบทดสอบหลังอ่าน/เกม) พร้อมขั้นทบทวน 1/3/7/14 วัน" },
];

// ชื่อคอลัมน์ภาษาไทย (ชื่อจริงในไฟล์ CSV ยังเป็นภาษาอังกฤษ — ชี้ที่หัวตารางเพื่อดู)
// ข้อมูลทุกชุดระบุคนด้วยชื่อผู้ใช้ (= รหัสนิสิต) ตามที่ขอความยินยอมไว้
const RS_LABELS = {
  registered_at: "วันที่สมัคร",
  active_days: "วันที่เข้าใช้",
  first_active_date: "เข้าใช้วันแรก",
  last_active_date: "เข้าใช้ล่าสุด",
  last_active_day_index: "วันที่เข้าใช้ล่าสุด (นับจากวันสมัคร)",
  reading_days: "วันที่อ่าน",
  longest_reading_streak: "อ่านติดกันนานสุด (วัน)",
  reading_rounds: "รอบอ่าน",
  reading_minutes: "นาทีที่อ่าน",
  avg_round_minutes: "นาทีเฉลี่ยต่อรอบ",
  rounds_stopped_early: "รอบที่หยุดก่อนครบ",
  reading_minutes_per_active_day: "นาทีอ่านต่อวันที่เข้าใช้",
  chapters_pretested: "บทที่ทำก่อนอ่าน",
  chapters_posttested: "บทที่ทำหลังอ่าน",
  avg_pre_score_pct: "ก่อนอ่านเฉลี่ย (%)",
  avg_post_score_pct: "หลังอ่านเฉลี่ย (%)",
  avg_gain_pct: "เพิ่มขึ้นเฉลี่ย (%)",
  chapters_passed: "บทที่ผ่าน",
  pet_visits: "เข้าหน้าสุนัข",
  pet_care_free: "ดูแลสุนัข (ฟรี)",
  pet_care_item: "ดูแลสุนัข (ใช้ไอเทม)",
  pet_care_free_per_active_day: "ดูแลฟรีต่อวันที่เข้าใช้",
  pet_level: "เลเวลสุนัข",
  pet_happiness_now: "ความสุขสุนัขตอนนี้",
  ai_questions: "ถาม AI",
  ai_questions_per_active_day: "ถาม AI ต่อวันที่เข้าใช้",
  chat_messages: "ข้อความแชท",
  game_battles: "ด่านที่เล่น",
  game_battles_won: "ด่านที่ชนะ",
  game_subject_answers: "ตอบคำถามบทเรียนในเกม",
  game_subject_correct_pct: "ตอบถูกในเกม (%)",
  game_subject_correct: "ตอบถูกในเกม",
  review_items: "ข้อที่อยู่ในรอบทบทวน",
  review_mastered: "ข้อที่จำได้แล้ว",
  review_due_answers: "ตอบตอนถึงรอบทบทวน",
  review_due_correct_pct: "ตอบถูกตอนถึงรอบ (%)",
  coins_from_reading: "คอยน์จากการอ่าน",
  coins_post_bonus: "คอยน์โบนัสหลังอ่าน",
  coins_now: "คอยน์ตอนนี้",
  purchases: "ซื้อของ",
  coins_spent: "คอยน์ที่ใช้",
  coupons_redeemed: "แลกคูปอง",
  date: "วันที่",
  day_index: "วันที่ (นับจากวันสมัคร)",
  weekday: "วันในสัปดาห์",
  test_answers: "ตอบแบบทดสอบ",
  session_id: "รหัสรอบ",
  chapter_number: "บท",
  chapter_attempt: "อ่านบทนี้ครั้งที่",
  started_at: "เริ่มอ่าน",
  hour: "ชั่วโมง",
  planned_minutes: "ตั้งเวลา (นาที)",
  read_minutes: "อ่านจริง (นาที)",
  away_minutes: "ออกจากหน้าอ่าน (นาที)",
  idle_minutes: "ไม่ขยับ (นาที)",
  stopped_early: "หยุดก่อนครบ",
  coins_time: "คอยน์จากเวลา",
  coins_paid: "จ่ายคอยน์แล้ว",
  ai_questions_during: "ถาม AI ระหว่างอ่าน",
  chat_messages_during: "แชทระหว่างอ่าน",
  pdf_total_pages: "จำนวนหน้า PDF",
  pages_viewed: "หน้าที่เปิดอ่าน",
  first_page_viewed: "หน้าแรกที่อ่าน",
  last_page_viewed: "หน้าสุดท้ายที่อ่าน",
  page_seconds_tracked: "วินาทีที่จับเวลาบน PDF",
  chapter_pre_score: "คะแนนก่อนอ่าน",
  chapter_post_score: "คะแนนหลังอ่าน (ครั้งแรก)",
  chapter_total: "คะแนนเต็ม",
  answered_at: "เวลาที่ตอบ",
  question_id: "รหัสคำถาม",
  source: "มาจาก",
  stage_before: "ขั้นก่อนตอบ",
  interval_days: "เว้นมา (วัน)",
  was_due: "ถึงรอบแล้ว",
  correct: "ถูก",
  stage_after: "ขั้นหลังตอบ",
  username: "ชื่อผู้ใช้ (รหัสนิสิต)",
  email: "อีเมล",
};

// ---- มุมมองการ์ด: อ่านง่ายกว่าตาราง CSV (หัวการ์ด = ใคร/เมื่อไหร่, ตัวเลขเด่น, ที่เหลือกางดูได้) ----
// ค่าที่เป็น 0/1 ให้อ่านเป็นคำแทนตัวเลข
const RS_YES_NO = {
  stopped_early: ["หยุดก่อนครบเวลา", "อ่านครบเวลา"],
  was_due: ["ถึงรอบทบทวนแล้ว", "ยังไม่ถึงรอบ"],
  correct: ["ตอบถูก", "ตอบผิด"],
};

const rsSum = (rows, col) => rows.reduce((a, r) => a + (Number(r[col]) || 0), 0);
const rsAvg = (rows, col) => {
  const nums = rows.map((r) => Number(r[col])).filter((n) => Number.isFinite(n));
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
};
const rsCount = (rows, col) => rows.filter((r) => Number(r[col]) === 1).length;
const rsPct = (rows, col) => (rows.length ? (rsCount(rows, col) / rows.length) * 100 : 0);
const rsRound1 = (n) => Math.round(n * 10) / 10;

const RS_CARD_VIEWS = {
  users: {
    title: (r) => r.username,
    subtitle: (r) => `สมัคร ${r.registered_at || "—"} · เข้าใช้ล่าสุด ${r.last_active_date || "ยังไม่เข้าใช้"}`,
    // active_days (วันที่เข้าใช้) ไม่เอาขึ้นหัวการ์ด เพราะอ่านแล้วเข้าใจผิดว่าเป็นจำนวนครั้ง
    // ตัวเลขยังอยู่ครบในไฟล์ CSV และใช้เป็นตัวหารของช่อง "ต่อวันที่เข้าใช้" เหมือนเดิม
    stats: ["reading_minutes", "avg_post_score_pct", "chapters_passed"],
    groups: [
      ["การอ่าน", ["first_active_date", "last_active_day_index", "reading_days", "longest_reading_streak", "reading_rounds", "avg_round_minutes", "rounds_stopped_early", "reading_minutes_per_active_day"]],
      ["แบบทดสอบก่อน/หลังอ่าน", ["chapters_pretested", "chapters_posttested", "avg_pre_score_pct", "avg_gain_pct"]],
      ["การทบทวน", ["review_items", "review_mastered", "review_due_answers", "review_due_correct_pct"]],
      ["สุนัขและมินิเกม", ["pet_visits", "pet_care_free", "pet_care_item", "pet_care_free_per_active_day", "pet_level", "pet_happiness_now", "game_battles", "game_battles_won", "game_subject_answers", "game_subject_correct_pct"]],
      ["ถาม AI และแชท", ["ai_questions", "ai_questions_per_active_day", "chat_messages"]],
      ["คอยน์และร้านค้า", ["coins_from_reading", "coins_post_bonus", "coins_now", "purchases", "coins_spent", "coupons_redeemed"]],
    ],
    summary: (rows) => [
      ["ผู้ใช้", rows.length],
      ["นาทีที่อ่านรวม", rsRound1(rsSum(rows, "reading_minutes"))],
      ["หลังอ่านเฉลี่ย (%)", rsRound1(rsAvg(rows, "avg_post_score_pct"))],
      ["บทที่ผ่านรวม", rsSum(rows, "chapters_passed")],
    ],
  },
  days: {
    title: (r) => `${r.username} · ${r.date}`,
    subtitle: (r) => `${r.weekday || ""} · วันที่ ${r.day_index} นับจากวันสมัคร`,
    stats: ["reading_minutes", "reading_rounds", "test_answers", "game_battles"],
    groups: [
      ["สุนัขและเกมในวันนั้น", ["pet_visits", "pet_care_free", "pet_care_item", "game_subject_answers", "game_subject_correct"]],
      ["ถาม AI และแชท", ["ai_questions", "chat_messages"]],
      ["ร้านค้า", ["purchases"]],
    ],
    summary: (rows) => [
      ["วันที่เข้าใช้ (แถว)", rows.length],
      ["นาทีที่อ่านรวม", rsRound1(rsSum(rows, "reading_minutes"))],
      ["รอบอ่านรวม", rsSum(rows, "reading_rounds")],
      ["ตอบแบบทดสอบรวม", rsSum(rows, "test_answers")],
    ],
  },
  sessions: {
    title: (r) => `${r.username} · บท ${r.chapter_number}`,
    subtitle: (r) => `เริ่มอ่าน ${r.started_at} · อ่านบทนี้ครั้งที่ ${r.chapter_attempt}`,
    stats: ["read_minutes", "planned_minutes", "pages_viewed", "stopped_early"],
    groups: [
      ["เวลาในรอบนี้", ["date", "weekday", "hour", "day_index", "away_minutes", "idle_minutes"]],
      ["การเปิดอ่าน PDF", ["pdf_total_pages", "first_page_viewed", "last_page_viewed", "page_seconds_tracked"]],
      ["คะแนนของบทนี้", ["chapter_pre_score", "chapter_post_score", "chapter_total"]],
      ["คอยน์ ถาม AI และแชท", ["coins_time", "coins_paid", "ai_questions_during", "chat_messages_during"]],
      ["รหัสอ้างอิง", ["session_id"]],
    ],
    summary: (rows) => [
      ["รอบอ่าน", rows.length],
      ["นาทีที่อ่านรวม", rsRound1(rsSum(rows, "read_minutes"))],
      ["นาทีเฉลี่ยต่อรอบ", rsRound1(rsAvg(rows, "read_minutes"))],
      ["หยุดก่อนครบเวลา", rsCount(rows, "stopped_early")],
    ],
  },
  reviews: {
    title: (r) => `${r.username} · ข้อ ${r.question_id}`,
    subtitle: (r) => `${r.answered_at} · บท ${r.chapter_number} · มาจาก${r.source === "game" ? "เกม" : "แบบทดสอบหลังอ่าน"}`,
    stats: ["correct", "was_due", "interval_days", "stage_after"],
    groups: [["ขั้นทบทวน", ["stage_before", "source"]]],
    summary: (rows) => {
      const due = rows.filter((r) => Number(r.was_due) === 1);
      return [
        ["ครั้งที่ตอบ", rows.length],
        ["ตอบถูก (%)", rsRound1(rsPct(rows, "correct"))],
        ["ตอบตอนถึงรอบ", due.length],
        ["ถูกตอนถึงรอบ (%)", rsRound1(rsPct(due, "correct"))],
      ];
    },
  },
};

const RS_CARD_PAGE = 6; // การ์ดต่อหน้า (การ์ดสูงกว่าแถวตาราง)

const RS_ROW_HEIGHT = 41; // ความสูงแถวโดยประมาณ (px) ใช้คำนวณว่าหน้าหนึ่งใส่ได้กี่แถว
const RS_MIN_ROWS = 5;

const rsState = {
  kind: RS_DATASETS[0].kind,
  view: "cards", // "cards" = การ์ดอ่านง่าย, "table" = ตารางเหมือนไฟล์ CSV
  cache: new Map(), // kind → { columns, rows }
  page: 0,
  query: "",
};

function rsDataset(kind = rsState.kind) {
  return RS_DATASETS.find((d) => d.kind === kind);
}

// จำนวนแถวต่อหน้า = เท่าที่ใส่ในกรอบตารางได้พอดี (หน้าเว็บจะได้ไม่ต้องเลื่อนลง)
function rsPageSize() {
  const wrap = document.getElementById("rsTableWrap");
  const head = document.querySelector("#rsTable thead");
  const available = wrap.clientHeight - (head ? head.offsetHeight : 48) - 18; // เผื่อแถบเลื่อนแนวนอน
  return Math.max(RS_MIN_ROWS, Math.floor(available / RS_ROW_HEIGHT));
}

function rsFilteredRows(data) {
  const q = rsState.query.trim().toLowerCase();
  if (!q) return data.rows;
  return data.rows.filter((row) => data.columns.some((c) => String(row[c] ?? "").toLowerCase().includes(q)));
}

function rsShowMessage(text) {
  const msg = document.getElementById("rsMessage");
  document.getElementById("rsTable").innerHTML = "";
  document.getElementById("rsCards").innerHTML = "";
  document.getElementById("rsSummary").innerHTML = "";
  msg.innerHTML = text;
  msg.hidden = false;
  document.getElementById("rsCount").textContent = "";
  document.getElementById("rsPage").textContent = "";
  document.getElementById("rsPrev").disabled = true;
  document.getElementById("rsNext").disabled = true;
}

function rsRenderTabs() {
  document.getElementById("rsTabs").innerHTML = RS_DATASETS.map((d) => {
    const data = rsState.cache.get(d.kind);
    const count = data ? ` <span class="rs-tab-count">${data.rows.length.toLocaleString()}</span>` : "";
    const selected = d.kind === rsState.kind;
    return `<button type="button" role="tab" class="rs-tab${selected ? " is-active" : ""}"
      aria-selected="${selected}" data-kind="${d.kind}">${d.label}${count}</button>`;
  }).join("");
  document.querySelectorAll(".rs-tab").forEach((btn) => btn.addEventListener("click", () => rsSelect(btn.dataset.kind)));
}

// ค่าที่โชว์ให้คน (ไม่ใช่ค่าดิบใน CSV): 0/1 เป็นคำ, เลขหลักหมื่นขึ้นไปใส่ลูกน้ำ, ว่างเป็นขีด
function rsValueText(col, raw) {
  if (raw === "" || raw === null || raw === undefined) return "—";
  if (RS_YES_NO[col]) return Number(raw) ? RS_YES_NO[col][0] : RS_YES_NO[col][1];
  const n = Number(raw);
  if (Number.isFinite(n) && String(raw).trim() !== "" && Math.abs(n) >= 10000) return n.toLocaleString("th-TH");
  return String(raw);
}

function rsLabel(col) {
  return RS_LABELS[col] || col;
}

// ตัวเลขสรุปของหมวดที่เปิดอยู่ (คิดจากแถวที่ค้นหาเหลืออยู่)
function rsRenderSummary(rows) {
  const box = document.getElementById("rsSummary");
  const view = RS_CARD_VIEWS[rsState.kind];
  if (!view || !rows.length) {
    box.innerHTML = "";
    return;
  }
  box.innerHTML = view
    .summary(rows)
    .map(
      ([label, value]) =>
        `<div class="rs-sum"><span class="rs-sum-value">${escapeHtml(
          typeof value === "number" ? value.toLocaleString("th-TH") : String(value)
        )}</span><span class="rs-sum-label">${escapeHtml(label)}</span></div>`
    )
    .join("");
}

// การ์ด 1 ใบ = 1 แถวในไฟล์ CSV แต่จัดให้อ่านเป็นภาษาคน
function rsCardHtml(row, columns) {
  const view = RS_CARD_VIEWS[rsState.kind];
  const used = new Set(view.stats);
  const stats = view.stats
    .map(
      (c) =>
        `<div class="rs-card-stat"><span class="rs-card-stat-value">${escapeHtml(
          rsValueText(c, row[c])
        )}</span><span class="rs-card-stat-label">${escapeHtml(rsLabel(c))}</span></div>`
    )
    .join("");

  const groups = view.groups.map(([title, cols]) => [title, cols.filter((c) => columns.includes(c))]);
  groups.forEach(([, cols]) => cols.forEach((c) => used.add(c)));
  const leftover = columns.filter((c) => !used.has(c) && c !== "username");
  if (leftover.length) groups.push(["อื่น ๆ", leftover]);

  const details = groups
    .filter(([, cols]) => cols.length)
    .map(
      ([title, cols]) => `<div class="rs-card-group">
        <h5>${escapeHtml(title)}</h5>
        <dl>${cols
          .map((c) => `<div><dt>${escapeHtml(rsLabel(c))}</dt><dd>${escapeHtml(rsValueText(c, row[c]))}</dd></div>`)
          .join("")}</dl>
      </div>`
    )
    .join("");

  const fieldCount = groups.reduce((a, [, cols]) => a + cols.length, 0);
  return `<article class="rs-card">
    <div class="rs-card-head">
      <div class="rs-card-who">
        <h4>${escapeHtml(view.title(row))}</h4>
        <p>${escapeHtml(view.subtitle(row))}</p>
      </div>
      <div class="rs-card-stats">${stats}</div>
    </div>
    ${details ? `<details class="rs-card-more"><summary>ดูข้อมูลทั้งหมด (${fieldCount} ค่า)</summary>${details}</details>` : ""}
  </article>`;
}

function rsRenderTable() {
  const d = rsDataset();
  document.getElementById("rsDesc").textContent = d.desc;

  const data = rsState.cache.get(d.kind);
  if (!data) return rsShowMessage("<p>กำลังโหลด...</p>");

  const rows = rsFilteredRows(data);
  if (!data.rows.length) return rsShowMessage("<p>ยังไม่มีข้อมูลในหมวดนี้</p>");
  if (!rows.length) return rsShowMessage(`<p>ไม่พบข้อมูลที่ตรงกับ “${escapeHtml(rsState.query)}”</p>`);

  document.getElementById("rsMessage").hidden = true;
  rsRenderSummary(rows);

  const cards = rsState.view === "cards";
  const table = document.getElementById("rsTable");
  const cardBox = document.getElementById("rsCards");
  table.hidden = cards;
  cardBox.hidden = !cards;
  document.getElementById("rsPanel").classList.toggle("is-cards", cards);

  let size;
  if (cards) {
    size = RS_CARD_PAGE;
    table.innerHTML = "";
  } else {
    // วาดหัวตารางก่อน แล้วค่อยคำนวณว่าใส่ได้กี่แถว
    cardBox.innerHTML = "";
    table.innerHTML = `<thead><tr>${data.columns
      .map((c) => `<th title="${c}" scope="col">${escapeHtml(rsLabel(c))}</th>`)
      .join("")}</tr></thead><tbody></tbody>`;
    size = rsPageSize();
  }

  const pages = Math.max(1, Math.ceil(rows.length / size));
  rsState.page = Math.min(rsState.page, pages - 1);
  const start = rsState.page * size;
  const shown = rows.slice(start, start + size);

  if (cards) {
    cardBox.innerHTML = shown.map((row) => rsCardHtml(row, data.columns)).join("");
  } else {
    table.querySelector("tbody").innerHTML = shown
      .map((row) => `<tr>${data.columns.map((c) => `<td>${escapeHtml(rsValueText(c, row[c]))}</td>`).join("")}</tr>`)
      .join("");
  }

  const end = start + shown.length;
  const unit = cards ? "การ์ด" : "แถว";
  const filtered = rows.length !== data.rows.length ? ` (จาก ${data.rows.length.toLocaleString()})` : "";
  const columnNote = cards ? "" : ` · ${data.columns.length} คอลัมน์`;
  document.getElementById("rsCount").textContent =
    `${unit} ${(start + 1).toLocaleString()}–${end.toLocaleString()} จาก ${rows.length.toLocaleString()}${filtered}${columnNote}`;
  document.getElementById("rsPage").textContent = `หน้า ${rsState.page + 1} / ${pages}`;
  document.getElementById("rsPrev").disabled = rsState.page === 0;
  document.getElementById("rsNext").disabled = rsState.page >= pages - 1;
}

async function rsLoad(kind) {
  if (rsState.cache.has(kind)) return;
  try {
    const data = await adminApiFetch(`/admin/export/${kind}/data`);
    rsState.cache.set(kind, data);
  } catch (err) {
    if (kind === rsState.kind) rsShowMessage(`<p>โหลดข้อมูลไม่สำเร็จ: ${escapeHtml(err.message)}</p>`);
    throw err;
  }
}

async function rsSelect(kind) {
  rsState.kind = kind;
  rsState.page = 0;
  rsRenderTabs();
  rsRenderTable();
  try {
    await rsLoad(kind);
  } catch {
    return;
  }
  if (rsState.kind !== kind) return; // เปลี่ยนแท็บไปแล้วระหว่างโหลด
  rsRenderTabs();
  rsRenderTable();
}

// ดาวน์โหลด CSV ของหมวดที่เปิดอยู่
async function rsDownload() {
  const btn = document.getElementById("rsDownload");
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "กำลังเตรียมไฟล์...";
  try {
    const response = await fetch(`${API_BASE_URL}/admin/export/${d.kind}`, {
      headers: { Authorization: `Bearer ${getAdminToken()}` },
    });
    if (response.status === 401 || response.status === 403) {
      clearAdminSession();
      window.location.href = "login.html";
      return;
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || `ดาวน์โหลดไม่สำเร็จ (${response.status})`);
    }
    const match = (response.headers.get("Content-Disposition") || "").match(/filename="([^"]+)"/);
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = match ? match[1] : `reading-buddy-${d.kind}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (!getAdminToken() || !document.getElementById("rsTabs")) return;
  document.getElementById("rsDownload").addEventListener("click", rsDownload);
  document.getElementById("rsPrev").addEventListener("click", () => {
    rsState.page -= 1;
    rsRenderTable();
  });
  document.getElementById("rsNext").addEventListener("click", () => {
    rsState.page += 1;
    rsRenderTable();
  });
  document.getElementById("rsViewToggle").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-view]");
    if (!btn || btn.dataset.view === rsState.view) return;
    rsState.view = btn.dataset.view;
    rsState.page = 0;
    document
      .querySelectorAll("#rsViewToggle button")
      .forEach((b) => b.classList.toggle("is-active", b === btn));
    rsRenderTable();
  });
  let searchTimer = null;
  document.getElementById("rsSearch").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      rsState.query = e.target.value;
      rsState.page = 0;
      rsRenderTable();
    }, 200);
  });
  // ย่อ/ขยายหน้าต่าง → จำนวนแถวต่อหน้าเปลี่ยน
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(rsRenderTable, 150);
  });

  rsSelect(rsState.kind);
  // โหลดจำนวนแถวของหมวดอื่นไว้ล่วงหน้า ให้แท็บโชว์ตัวเลข
  RS_DATASETS.filter((d) => d.kind !== rsState.kind).forEach((d) =>
    rsLoad(d.kind).then(rsRenderTabs).catch(() => {})
  );
});
