// ================== ข้อมูลวิจัย: ดูข้อมูลชุดเดียวกับไฟล์ CSV เป็นตารางในเว็บ ==================
// แท็บด้านบน = หมวดข้อมูล | ตารางแบ่งหน้า (ไม่ต้องเลื่อนหน้าลง) | ปุ่มดาวน์โหลด CSV ของหมวดที่เปิดอยู่
// ข้อมูลจาก GET /api/admin/export/:kind/data — คอลัมน์/ความหมายดูที่ BACKEND/src/services/researchExport.js

const RS_DATASETS = [
  { kind: "users", label: "รายคน", desc: "1 แถว = ผู้ใช้ 1 คน (สรุปตลอดการใช้งาน)" },
  { kind: "days", label: "รายวัน", desc: "1 แถว = ผู้ใช้ 1 คน × 1 วันที่เข้าใช้" },
  { kind: "sessions", label: "รายรอบอ่าน", desc: "1 แถว = รอบอ่าน 1 รอบ" },
  { kind: "reviews", label: "การทบทวน", desc: "1 แถว = ตอบคำถามบทเรียน 1 ครั้ง (แบบทดสอบหลังอ่าน/เกม) พร้อมขั้นทบทวน 1/3/7/14 วัน" },
  {
    kind: "user-key",
    label: "🔑 ตารางรหัสผู้ใช้",
    desc: "จับคู่รหัสผู้ใช้กับชื่อผู้ใช้และอีเมล — มีข้อมูลส่วนบุคคล เก็บแยก ห้ามแนบเล่มหรือส่งต่อ",
    sensitive: true,
  },
];

// ชื่อคอลัมน์ภาษาไทย (ชื่อจริงในไฟล์ CSV ยังเป็นภาษาอังกฤษ — ชี้ที่หัวตารางเพื่อดู)
const RS_LABELS = {
  user_code: "รหัสผู้ใช้",
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
  username: "ชื่อผู้ใช้",
  email: "อีเมล",
};

const RS_ROW_HEIGHT = 41; // ความสูงแถวโดยประมาณ (px) ใช้คำนวณว่าหน้าหนึ่งใส่ได้กี่แถว
const RS_MIN_ROWS = 5;

const rsState = {
  kind: RS_DATASETS[0].kind,
  cache: new Map(), // kind → { columns, rows }
  revealed: new Set(), // หมวดข้อมูลส่วนบุคคลที่กดยืนยันดูแล้ว
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
    return `<button type="button" role="tab" class="rs-tab${d.sensitive ? " is-sensitive" : ""}${selected ? " is-active" : ""}"
      aria-selected="${selected}" data-kind="${d.kind}">${d.label}${count}</button>`;
  }).join("");
  document.querySelectorAll(".rs-tab").forEach((btn) => btn.addEventListener("click", () => rsSelect(btn.dataset.kind)));
}

function rsRenderTable() {
  const d = rsDataset();
  document.getElementById("rsDesc").textContent = d.desc;

  if (d.sensitive && !rsState.revealed.has(d.kind)) {
    return rsShowMessage(
      `<p>ตารางนี้มีชื่อผู้ใช้และอีเมล (ข้อมูลส่วนบุคคล) ใช้ดูว่ารหัส U0001 ฯลฯ เป็นใครเท่านั้น</p>
       <button type="button" class="rs-reveal" id="rsReveal">แสดงข้อมูล</button>`
    );
  }
  const data = rsState.cache.get(d.kind);
  if (!data) return rsShowMessage("<p>กำลังโหลด...</p>");

  const rows = rsFilteredRows(data);
  if (!data.rows.length) return rsShowMessage("<p>ยังไม่มีข้อมูลในหมวดนี้</p>");
  if (!rows.length) return rsShowMessage(`<p>ไม่พบแถวที่ตรงกับ “${escapeHtml(rsState.query)}”</p>`);

  document.getElementById("rsMessage").hidden = true;
  const table = document.getElementById("rsTable");
  // วาดหัวตารางก่อน แล้วค่อยคำนวณว่าใส่ได้กี่แถว
  table.innerHTML = `<thead><tr>${data.columns
    .map((c) => `<th title="${c}" scope="col">${escapeHtml(RS_LABELS[c] || c)}</th>`)
    .join("")}</tr></thead><tbody></tbody>`;
  const size = rsPageSize();
  const pages = Math.max(1, Math.ceil(rows.length / size));
  rsState.page = Math.min(rsState.page, pages - 1);
  const start = rsState.page * size;
  table.querySelector("tbody").innerHTML = rows
    .slice(start, start + size)
    .map((row) => `<tr>${data.columns.map((c) => `<td>${escapeHtml(row[c] ?? "")}</td>`).join("")}</tr>`)
    .join("");

  const end = Math.min(start + size, rows.length);
  const filtered = rows.length !== data.rows.length ? ` (จาก ${data.rows.length.toLocaleString()})` : "";
  document.getElementById("rsCount").textContent =
    `แถว ${(start + 1).toLocaleString()}–${end.toLocaleString()} จาก ${rows.length.toLocaleString()}${filtered} · ${data.columns.length} คอลัมน์`;
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
  const d = rsDataset(kind);
  if (d.sensitive && !rsState.revealed.has(kind)) return;
  try {
    await rsLoad(kind);
  } catch {
    return;
  }
  if (rsState.kind !== kind) return; // เปลี่ยนแท็บไปแล้วระหว่างโหลด
  rsRenderTabs();
  rsRenderTable();
}

// ดาวน์โหลด CSV ของหมวดที่เปิดอยู่ (ไฟล์เดียวกับปุ่มดาวน์โหลดในหน้าหลักเดิม)
async function rsDownload() {
  const d = rsDataset();
  if (
    d.sensitive &&
    !confirm(
      "ไฟล์นี้มีชื่อผู้ใช้และอีเมล (ข้อมูลส่วนบุคคล)\n" +
        "ใช้ดูว่ารหัส U0001 ฯลฯ เป็นใครเท่านั้น เก็บแยกจากไฟล์ข้อมูลวิจัย ห้ามแนบในเล่มหรือส่งต่อ\n\nดาวน์โหลดต่อไหม?"
    )
  ) {
    return;
  }
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
  if (!getAdminToken()) return;
  document.getElementById("rsDownload").addEventListener("click", rsDownload);
  document.getElementById("rsPrev").addEventListener("click", () => {
    rsState.page -= 1;
    rsRenderTable();
  });
  document.getElementById("rsNext").addEventListener("click", () => {
    rsState.page += 1;
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
  // ปุ่ม "แสดงข้อมูล" ของตารางรหัสผู้ใช้ (สร้างใหม่ทุกครั้งที่วาด จึงผูกผ่านกรอบตาราง)
  document.getElementById("rsMessage").addEventListener("click", (e) => {
    if (e.target.id !== "rsReveal") return;
    rsState.revealed.add(rsState.kind);
    rsSelect(rsState.kind);
  });
  // ย่อ/ขยายหน้าต่าง → จำนวนแถวต่อหน้าเปลี่ยน
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(rsRenderTable, 150);
  });

  rsSelect(rsState.kind);
  // โหลดจำนวนแถวของหมวดอื่นไว้ล่วงหน้า (ยกเว้นตารางรหัสผู้ใช้) ให้แท็บโชว์ตัวเลข
  RS_DATASETS.filter((d) => !d.sensitive && d.kind !== rsState.kind).forEach((d) =>
    rsLoad(d.kind).then(rsRenderTabs).catch(() => {})
  );
});
