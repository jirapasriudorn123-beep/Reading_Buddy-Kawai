// ================== ตัวช่วยเรียก API (เหมือนกับ script.js ของหน้า index) ==================

function getToken() {
  return localStorage.getItem("token");
}

async function apiFetch(path, options = {}) {
  const token = getToken();

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

  if (response.status === 401) {
    localStorage.removeItem("token");
    localStorage.removeItem("currentUser");
    window.location.href = "login.html";
    throw new Error("Unauthorized");
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data.message || "เกิดข้อผิดพลาด");
    err.data = data;
    throw err;
  }
  return data;
}

function secondsToMinutes(seconds) {
  return Math.round((seconds / 60) * 10) / 10; // ปัดทศนิยม 1 ตำแหน่ง
}

// สีธีมเดียวกับที่ใช้ในหน้าอื่นของโปรเจกต์ (เขียว/เหลืองของ chapter card)
const CHART_COLORS = {
  green: "#8db754",
  yellow: "#f9e79f",
  orange: "#f8b133",
  grid: "rgba(0,0,0,0.08)",
};

// ================== เริ่มทำงานเมื่อโหลดหน้า ==================

document.addEventListener("DOMContentLoaded", async () => {
  if (!getToken()) {
    window.location.href = "login.html";
    return;
  }

  bindStaticEventListeners();

  try {
    await Promise.all([
      loadUserInfo(),
      loadTodayProgress(),
      loadWeeklySummary(),
      loadWeeklyProgress(),
      loadFocusChart(),
      loadTrendChart(),
    ]);
  } catch (err) {
    console.error("โหลดข้อมูล Dashboard ไม่สำเร็จ:", err);
  }
  startPageTour("dashboard"); // คำแนะนำการใช้งาน (ครั้งแรกที่เข้าหน้านี้)
});

// ================== ผู้ใช้ + เหรียญ ==================

async function loadUserInfo() {
  const { user } = await apiFetch("/auth/me");
  document.getElementById("coinAmount").textContent = user.coins;
}

// ================== การ์ด 1: สัปดาห์นี้เทียบสัปดาห์ก่อน | การ์ด 2: สรุปการเรียน 7 วันของคุณ ==================
// ข้อความบนการ์ดใช้คำธรรมดา: บอกตัวเลขทั้งสองสัปดาห์ตรงๆ ("ลดลงจาก 75%") ไม่ใช้คำว่า "จุด"
// สี: เขียวของเว็บ = ดี/เด่น, ส้มเหลือง = ต้องระวัง, เบจ = ข้อมูลประกอบ

const WP_THAI_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const WP_PASS_RATIO = 0.8; // ต้องตรงกับ PASS_RATIO ใน BACKEND/src/services/chapterTests.js
const WP_QUESTIONS_PER_TEST = 10; // ต้องตรงกับ QUESTIONS_PER_TEST ใน BACKEND/src/services/chapterTests.js
let wpChart = null;
let wpProgress = null;

// สลับธีมระหว่างเปิดหน้านี้ (theme.js เปลี่ยน class ที่ <html>) → วาดกราฟใหม่ด้วยสีของธีมนั้น
new MutationObserver(() => {
  if (wpProgress) renderWeeklyChart(wpProgress);
}).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

function wpShortDate(iso) {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${WP_THAI_MONTHS[m - 1]}`;
}

// บรรทัดใต้ตัวเลข: "▲ เพิ่มขึ้นจาก …" (เขียว) / "▼ ลดลงจาก …" (ส้ม) / ข้อความเฉยๆ (เทา)
function wpDelta(el, dir, text) {
  el.className = `wp-kpi-delta is-${dir}`;
  el.textContent = dir === "up" ? `▲ ${text}` : dir === "down" ? `▼ ${text}` : text;
}

function wpChange(el, now, prev, unit, { muted = false } = {}) {
  if (now === prev) return wpDelta(el, "flat", "เท่ากับสัปดาห์ก่อน");
  const dir = muted ? "flat" : now > prev ? "up" : "down";
  wpDelta(el, dir, `${now > prev ? "เพิ่มขึ้น" : "ลดลง"}จาก ${prev}${unit}`);
}

function renderWeeklyKpis(p) {
  const now = p.thisWeek;
  const prev = p.lastWeek;
  document.getElementById("wpRange").textContent =
    `${wpShortDate(now.from)}–${wpShortDate(now.to)} เทียบ ${wpShortDate(prev.from)}–${wpShortDate(prev.to)}`;

  const acc = document.getElementById("wpAccDelta");
  document.getElementById("wpAcc").textContent = now.percent === null ? "–" : `${now.percent}%`;
  if (now.percent === null) wpDelta(acc, "flat", "สัปดาห์นี้ยังไม่ได้ตอบคำถาม");
  else if (prev.percent === null) wpDelta(acc, "flat", "สัปดาห์ก่อนยังไม่มีคำตอบ");
  // ข้อมูลน้อยหรือต่างกันนิดเดียว: บอกตัวเลขแต่เป็นสีเทา ไม่ขึ้นเขียว/ส้ม
  else wpChange(acc, now.percent, prev.percent, "%", { muted: p.trend === "not_enough" || p.trend === "steady" });

  document.getElementById("wpMin").textContent = `${now.minutes} นาที`;
  const min = document.getElementById("wpMinDelta");
  if (prev.minutes === 0) wpDelta(min, "flat", now.minutes > 0 ? "สัปดาห์ก่อนไม่ได้อ่าน" : "ยังไม่ได้อ่าน");
  else wpChange(min, now.minutes, prev.minutes, " นาที");

  document.getElementById("wpDays").textContent = `${now.daysRead}/7 วัน`;
  wpChange(document.getElementById("wpDaysDelta"), now.daysRead, prev.daysRead, " วัน");
}

function renderWeeklyChart(p) {
  const dark = document.documentElement.classList.contains("dark-mode");
  const ink = dark ? "#b4b2a9" : "#6b6a65";
  const grid = dark ? "#33363b" : "#ece5d3";
  const past = dark ? "#4a4a44" : "#e3dcc6";
  const passLine = dark ? "#c9a58f" : "#8b6655";
  const current = p.trend === "down" ? "#f0b23d" : "#8db754";
  const labels = ["3 สัปดาห์ก่อน", "2 สัปดาห์ก่อน", "สัปดาห์ก่อน", "สัปดาห์นี้"];
  const values = p.weeks.map((w) => w.percent);
  const canvas = document.getElementById("wpChart");
  canvas.setAttribute(
    "aria-label",
    "กราฟแท่ง % ตอบถูกรายสัปดาห์: " +
      p.weeks.map((w, i) => `${labels[i]} ${w.percent === null ? "ไม่มีข้อมูล" : w.percent + "%"}`).join(", ") +
      ` เทียบเกณฑ์ผ่าน ${p.passPercent}%`
  );
  if (wpChart) wpChart.destroy();
  wpChart = new Chart(canvas, {
    type: "bar",
    data: {
      // ป้ายแกนแบ่ง 2 บรรทัด จะได้ไม่ต้องเอียงบนจอแคบ
      labels: [["3 สัปดาห์", "ก่อน"], ["2 สัปดาห์", "ก่อน"], ["สัปดาห์", "ก่อน"], ["สัปดาห์", "นี้"]],
      datasets: [
        {
          data: values,
          backgroundColor: values.map((_, i) => (i === values.length - 1 ? current : past)),
          borderRadius: { topLeft: 6, topRight: 6 },
          borderSkipped: "bottom",
          maxBarThickness: 40,
        },
        {
          type: "line",
          data: labels.map(() => p.passPercent),
          borderColor: passLine,
          borderDash: [5, 4],
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: (item) => item.datasetIndex === 0,
          callbacks: {
            title: (items) => {
              const w = p.weeks[items[0].dataIndex];
              return `${labels[items[0].dataIndex]} (${wpShortDate(w.from)}–${wpShortDate(w.to)})`;
            },
            label: (item) => {
              const w = p.weeks[item.dataIndex];
              return `ตอบถูก ${w.percent}% (${w.correct} จาก ${w.answered} ข้อ)`;
            },
          },
        },
      },
      scales: {
        y: { min: 0, max: 100, ticks: { stepSize: 20, color: ink, callback: (v) => `${v}%` }, grid: { color: grid }, border: { display: false } },
        x: { ticks: { color: ink, font: { family: "Kanit" }, maxRotation: 0, autoSkip: false }, grid: { display: false } },
      },
    },
  });
}

// กล่องข้อความใต้กราฟ: หัวกล่อง 1 บรรทัด + รายละเอียดเป็นตัวเลขสองสัปดาห์ + (ถ้าแย่ลง/ข้อมูลน้อย) ปุ่มทำต่อ
function renderWeeklyMessage(p) {
  const box = document.getElementById("wpMessage");
  const now = p.thisWeek;
  const prev = p.lastWeek;
  const reviewLink = `<a class="wp-action" href="game.html">🎮 ทบทวนในเกม${p.reviewDue > 0 ? ` (${p.reviewDue} ข้อรอทบทวน)` : ""}</a>`;
  const toPass = now.percent !== null && now.percent < p.passPercent ? ` อีก ${p.passPercent - now.percent}% จะถึงเกณฑ์ผ่าน ${p.passPercent}%` : "";
  const show = (kind, title, detail, actions = "") => {
    box.className = `wp-message is-${kind}`;
    box.innerHTML =
      `<p class="wp-message-title">${title}</p><p>${detail}</p>` + (actions ? `<div class="wp-actions">${actions}</div>` : "");
  };

  if (p.trend === "up") {
    return show(
      "up",
      "สัปดาห์นี้ตอบถูกมากกว่าสัปดาห์ก่อน",
      `สัปดาห์ก่อนตอบถูก ${prev.percent}% สัปดาห์นี้ได้ ${now.percent}%${toPass || " ผ่านเกณฑ์แล้ว เก่งมาก!"}`
    );
  }
  if (p.trend === "steady") {
    return show(
      "flat",
      "สัปดาห์นี้ตอบถูกพอๆ กับสัปดาห์ก่อน",
      `สัปดาห์ก่อนตอบถูก ${prev.percent}% สัปดาห์นี้ได้ ${now.percent}%${toPass ? `${toPass} ลองทบทวนข้อที่ยังผิดดูนะ` : " รักษาระดับนี้ไว้นะ"}`
    );
  }
  if (p.trend === "not_enough") {
    return show(
      "flat",
      "ยังเทียบกับสัปดาห์ก่อนไม่ได้",
      `ต้องตอบคำถามอย่างน้อย ${p.minAnswers} ข้อในแต่ละสัปดาห์ถึงจะเทียบได้ (สัปดาห์นี้ตอบไป ${now.answered} ข้อ) ลองเล่นด่านบทเรียนในเกมสัก 1 ด่านนะ`,
      reviewLink
    );
  }

  let detail = `สัปดาห์ก่อนตอบถูก ${prev.percent}% สัปดาห์นี้เหลือ ${now.percent}%`;
  if (p.readingDropped) detail += ` และสัปดาห์นี้อ่านแค่ ${now.minutes} นาที น้อยกว่าสัปดาห์ก่อนที่อ่าน ${prev.minutes} นาที ลองอ่านเพิ่มอีกหน่อยนะ`;
  else if (p.weakChapter) detail += ` ข้อที่ผิดส่วนใหญ่อยู่ในบทที่ ${p.weakChapter.number} ลองกลับไปอ่านบทนี้อีกรอบนะ`;
  else detail += " ลองทบทวนข้อที่ยังผิดในเกมดูนะ";
  show(
    "down",
    "สัปดาห์นี้ตอบถูกน้อยกว่าสัปดาห์ก่อน",
    detail,
    reviewLink +
      (p.weakChapter ? `<a class="wp-action" href="index.html?chapter=${p.weakChapter.number}">📖 อ่านบทที่ ${p.weakChapter.number} อีก 1 รอบ</a>` : "")
  );
}

// ---------- การ์ด 2: 3 หัวข้อ (ประโยคสรุปตัวหนามาก่อน กราฟเล็กประกอบ) — หัวข้อที่ไม่มีข้อมูลจะไม่แสดง ----------

// หมายเลขหัวข้อใส่ตอนรวม (หัวข้อที่ไม่มีข้อมูลถูกข้าม เลขจะได้ไม่กระโดด)
function wsSection(kicker, takeaway, body) {
  return { kicker, html: `<p class="ws-take">${takeaway}</p>${body}` };
}

function wsChapterMinutes(stats) {
  const rows = stats.chapterMinutes || [];
  if (!rows.length) return null;
  const max = Math.max(...rows.map((r) => r.minutes), 1);
  const top = rows[0];
  const least = rows.length >= 2 ? rows[rows.length - 1] : null;
  const takeaway = least && least.chapter !== top.chapter
    ? `อ่านบทที่ ${top.chapter} มากที่สุด ส่วนบทที่ ${least.chapter} อ่านน้อย`
    : `สัปดาห์นี้อ่านบทที่ ${top.chapter}`;
  const bars = rows
    .map(
      (r, i) => `
        <div class="ws-row">
          <span class="ws-row-label">บทที่ ${r.chapter}</span>
          <div class="ws-track"><div class="ws-bar${i === 0 ? " is-top" : ""}" style="width:${Math.max(4, (r.minutes / max) * 100)}%" title="บทที่ ${r.chapter} ${escapeHtml(r.title)}: ${r.minutes} นาที"></div></div>
          <span class="ws-row-value">${r.minutes} นาที</span>
        </div>`
    )
    .join("");
  return wsSection("อ่านบทไหนไปบ้าง", takeaway, bars);
}

function wsPrePost(stats) {
  // บทเดียวกันทำหลายชุดในสัปดาห์นี้ → ใช้ชุดล่าสุด
  // เกณฑ์ผ่านคิดจากจำนวนข้อของชุดนั้นเสมอ (ชุดเก่าก่อน 23 ต.ค. 2569 มี 5 ข้อ ชุดใหม่ 10 ข้อ)
  // ส่วนคำอธิบายใต้กราฟบอกเกณฑ์ของแบบทดสอบชุดปัจจุบัน ให้รู้ว่าถ้าทำตอนนี้ต้องได้เท่าไหร่
  const byChapter = new Map();
  for (const t of stats.postTests || []) byChapter.set(t.chapter, t);
  const tests = [...byChapter.values()].sort((a, b) => a.chapter - b.chapter);
  if (!tests.length) return null;
  const passOf = (t) => Math.ceil(t.total * WP_PASS_RATIO);
  const parts = tests.map((t) =>
    t.post >= passOf(t) ? `บทที่ ${t.chapter} ผ่านแล้ว` : `บทที่ ${t.chapter} ยังขาดอีก ${passOf(t) - t.post} คะแนน`
  );
  // บทที่ใช้ชุดเก่า (ข้อไม่เท่าแบบทดสอบตอนนี้) ต้องบอกจำนวนข้อกำกับไว้ ไม่งั้นคะแนนจะอ่านผิด
  const oldSet = (t) => t.total !== WP_QUESTIONS_PER_TEST;
  const rows = tests
    .map((t) => {
      const pct = (v) => (v / t.total) * 100;
      const ok = t.post >= passOf(t);
      const hasPre = t.pre !== null && t.pre !== undefined;
      const from = hasPre ? Math.min(t.pre, t.post) : t.post;
      const value = hasPre
        ? `${t.pre} → ${t.post}${oldSet(t) ? `<span class="ws-row-total">จาก ${t.total} ข้อ</span>` : ""}`
        : `${t.post}/${t.total}`;
      return `
        <div class="ws-row">
          <span class="ws-row-label">บทที่ ${t.chapter}</span>
          <div class="ws-dumbbell">
            <div class="ws-db-line"></div>
            <div class="ws-db-pass" style="left:${pct(passOf(t))}%"></div>
            ${hasPre ? `<div class="ws-db-gap${ok ? " is-ok" : ""}" style="left:${pct(from)}%;width:${pct(Math.abs(t.post - t.pre))}%"></div>` : ""}
            ${hasPre ? `<div class="ws-db-pre" style="left:${pct(t.pre)}%" title="ก่อนอ่าน ${t.pre}/${t.total}"></div>` : ""}
            <div class="ws-db-post${ok ? " is-ok" : ""}" style="left:${pct(t.post)}%" title="หลังอ่าน ${t.post}/${t.total}"></div>
          </div>
          <span class="ws-row-value">${value}</span>
        </div>`;
    })
    .join("");
  const passText = `┆ แบบทดสอบตอนนี้มี ${WP_QUESTIONS_PER_TEST} ข้อ ต้องได้ ${Math.ceil(
    WP_QUESTIONS_PER_TEST * WP_PASS_RATIO
  )} ข้อ (${WP_PASS_RATIO * 100}%) ถึงจะผ่าน`;
  return wsSection(
    "คะแนนดีขึ้นแค่ไหน",
    parts.join(" · "),
    rows + `<p class="ws-legend">○ ก่อนอ่าน &nbsp; ● หลังอ่าน &nbsp; ${passText}</p>`
  );
}

function wsWeakSpots(stats) {
  const weak = (stats.weakQuestions || []).slice(0, 2);
  if (!stats.gameAnswers && !weak.length) return null;
  const game = stats.gameAnswers ? `ในเกมตอบถูก ${stats.gameCorrect} จาก ${stats.gameAnswers} ข้อ` : "";
  const topics = weak.filter((w) => w.topic).length;
  const takeaway = weak.length
    ? `${game ? `${game} ` : ""}${topics === weak.length ? `ควรทบทวนอีก ${weak.length} หัวข้อ` : `เหลือ ${weak.length} ข้อที่ยังผิดบ่อย`}`
    : `${game} ไม่มีข้อที่ผิดซ้ำ เยี่ยมมาก`;
  // แอดมินใส่หัวข้อย่อยไว้ → บอกเป็นหัวข้อที่ควรทบทวน ถ้ายังไม่ได้ใส่ → แสดงข้อความคำถามเหมือนเดิม
  const list = weak
    .map(
      (w) => `<li>${w.chapter ? `<span class="ws-chip">บทที่ ${w.chapter}</span>` : ""}<span>${
        w.topic
          ? `หัวข้อ <strong>${escapeHtml(w.topic)}</strong>${w.questions > 1 ? ` · ${w.questions} ข้อ` : ""}`
          : escapeHtml(w.question)
      }</span></li>`
    )
    .join("");
  return wsSection("ยังพลาดเรื่องอะไร", takeaway, list ? `<ul class="ws-weak">${list}</ul>` : "");
}

function renderSummarySections(stats) {
  const box = document.getElementById("wsSections");
  if (!stats) {
    box.innerHTML = "";
    return;
  }
  const html = [wsChapterMinutes(stats), wsPrePost(stats), wsWeakSpots(stats)]
    .filter(Boolean)
    .map((sec, i) => `<section class="ws-section"><p class="ws-kicker">${i + 1} · ${sec.kicker}</p>${sec.html}</section>`)
    .join("");
  box.innerHTML = html || `<p class="ws-empty">7 วันที่ผ่านมายังไม่มีการอ่านหรือทำแบบทดสอบเลย เริ่มอ่านสัก 1 รอบแล้วน้องหมาจะสรุปให้นะ</p>`;
}

async function loadWeeklySummary() {
  const text = document.getElementById("weeklySummary");
  const note = document.getElementById("weeklySummaryNote");
  try {
    const data = await apiFetch("/analytics/weekly-summary");
    if (data.progress) {
      wpProgress = data.progress;
      renderWeeklyKpis(data.progress);
      renderWeeklyChart(data.progress);
      renderWeeklyMessage(data.progress);
      const w = data.progress.thisWeek;
      document.getElementById("wsRange").textContent = `${wpShortDate(w.from)}–${wpShortDate(w.to)}`;
    }
    renderSummarySections(data.stats);
    // สรุปที่เก็บไว้ก่อนเปลี่ยนรูปแบบอาจเป็นข้อๆ — รวมเป็นบรรทัดเดียว
    text.textContent = data.summary.replace(/^[-•*💡]\s*/gmu, "").split("\n").map((l) => l.trim()).filter(Boolean).join(" ");
    note.textContent =
      data.source === "ai"
        ? "AI เขียนจากตัวเลขด้านบน (ตรวจตัวเลขแล้ว) · อัปเดตวันละครั้ง"
        : "สรุปจากข้อมูลการอ่านจริงของคุณ · อัปเดตวันละครั้ง";
  } catch (err) {
    console.error("โหลดสรุปการอ่านไม่สำเร็จ:", err);
    document.getElementById("wsSections").innerHTML = "";
    text.textContent = "ยังสรุปไม่ได้ตอนนี้ ลองใหม่อีกครั้งนะ";
  }
}

// ================== เป้าหมายวันนี้ (progress bar + กราฟเปรียบเทียบ) ==================

async function loadTodayProgress() {
  const { goalSeconds, readSecondsToday, percent } = await apiFetch("/analytics/today-progress");

  const bar = document.getElementById("todayProgressBar");
  bar.style.width = `${percent}%`;
  bar.textContent = `${percent}%`;

  const goalMin = secondsToMinutes(goalSeconds);
  const readMin = secondsToMinutes(readSecondsToday);

  document.getElementById("progressDetail").textContent =
    goalSeconds > 0
      ? `อ่านไปแล้ว ${readMin} นาที จากเป้าหมาย ${goalMin} นาที`
      : `ยังไม่ได้ตั้งเป้าหมายเวลาอ่าน (ตั้งได้จากหน้า Home)`;
}

const THAI_MONTHS_SHORT = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

function formatShortDate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return `${d.getDate()} ${THAI_MONTHS_SHORT[d.getMonth()]}`;
}

// เปรียบเทียบเวลาอ่านจริง vs เป้าหมาย ย้อนหลัง 5 สัปดาห์ (เรียงเก่า -> ใหม่ สัปดาห์นี้อยู่ขวาสุด)
async function loadWeeklyProgress() {
  const { weeks } = await apiFetch("/analytics/weekly-progress?weeks=5");

  const labels = weeks.map((w, i) => [`สัปดาห์ ${i + 1}`, `${formatShortDate(w.startDate)} - ${formatShortDate(w.endDate)}`]);
  const readMinutes = weeks.map((w) => secondsToMinutes(w.readSeconds));
  const goalMinutes = weeks.map((w) => secondsToMinutes(w.goalSeconds));

  renderReadingVsGoalChart(labels, readMinutes, goalMinutes);
}

function renderReadingVsGoalChart(labels, readMinutes, goalMinutes) {
  const ctx = document.getElementById("readingChart");
  if (!ctx || typeof Chart === "undefined") return;

  new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "เวลาที่อ่าน",
          data: readMinutes,
          backgroundColor: CHART_COLORS.green,
          borderRadius: 8,
        },
        {
          label: "เป้าหมาย",
          data: goalMinutes,
          backgroundColor: CHART_COLORS.yellow,
          borderRadius: 8,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, grid: { color: CHART_COLORS.grid } },
        x: { grid: { display: false } },
      },
    },
  });
}

// ================== การจำแนกเวลาโฟกัส (แยกตาม chapter) ==================

async function loadFocusChart() {
  const { chapters } = await apiFetch("/analytics/focus-by-chapter");
  renderFocusChart(chapters);
}

function renderFocusChart(chapters) {
  const ctx = document.getElementById("focusChart");
  if (!ctx || typeof Chart === "undefined") return;

  const minutes = chapters.map((c) => secondsToMinutes(c.totalSeconds));
  // CH1-CH5 ใช้โทนสีตามลำดับ, CH6 ใช้เฉดพาสเทล (อ่อนกว่า) ของสีที่ 5
  const palette = ["#E2F0BD", "#8DB654", "#FBE577", "#FFBA18", "#DB5B23", "#F1BDA7"];
  const colors = chapters.map((_, i) => palette[i % palette.length]);

  // คำอธิบายสีเขียนเองด้านขวาของวง (legend ของ Chart.js วางขวาแล้วชื่อบทยาวโดนตัด)
  const legend = document.getElementById("focusLegend");
  if (legend) {
    legend.innerHTML = chapters
      .map(
        (c, i) => `<li>
          <span class="focus-legend-dot" style="background:${colors[i]}"></span>
          <span class="focus-legend-name">CH${c.chapter_number}: ${escapeHtml(c.title)}</span>
          <span class="focus-legend-value">${minutes[i]} นาที</span>
        </li>`
      )
      .join("");
  }

  new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: chapters.map((c) => `CH${c.chapter_number}: ${c.title}`),
      datasets: [
        {
          data: minutes,
          backgroundColor: colors,
        },
      ],
    },
    options: {
      responsive: true,
      // กล่องครอบกำหนดขนาดไว้แล้ว (.focus-chart-box) ไม่งั้นวงโดนัทจะกว้างเท่าการ์ดและใหญ่เกินไป
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => `${item.label}: ${item.raw} นาที`,
          },
        },
      },
    },
  });
}

// ================== แนวโน้มการอ่านย้อนหลัง 7 วัน ==================

async function loadTrendChart() {
  const { trend } = await apiFetch("/analytics/trend?days=7");
  renderTrendChart(trend);
}

function renderTrendChart(trend) {
  const ctx = document.getElementById("trendChart");
  if (!ctx || typeof Chart === "undefined") return;

  const labels = trend.map((t) => t.date.slice(5)); // ตัดปีออก เหลือ MM-DD
  const minutes = trend.map((t) => secondsToMinutes(t.totalSeconds));

  new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "เวลาอ่าน (นาที)",
          data: minutes,
          borderColor: CHART_COLORS.green,
          backgroundColor: "rgba(141, 183, 84, 0.15)",
          fill: true,
          tension: 0.3,
          pointRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, grid: { color: CHART_COLORS.grid } },
        x: { grid: { display: false } },
      },
    },
  });
}

// ================== Logout + sidebar toggle (เหมือนหน้า index) ==================

function logout() {
  localStorage.removeItem("token");
  localStorage.removeItem("currentUser");
  window.location.href = "login.html";
}

function bindStaticEventListeners() {
  document.getElementById("logoutBtn").addEventListener("click", (e) => {
    e.preventDefault();
    logout();
  });

  const toggleBtn = document.getElementById("toggleBtn");
  const sidebar = document.querySelector(".sidebar");
  if (toggleBtn && sidebar) {
    if (localStorage.getItem("sidebarCollapsed") === "1") {
      sidebar.classList.add("icon-collapsed");
    }
    toggleBtn.addEventListener("click", () => {
      sidebar.classList.toggle("icon-collapsed");
      localStorage.setItem("sidebarCollapsed", sidebar.classList.contains("icon-collapsed") ? "1" : "0");
    });
  }
}
