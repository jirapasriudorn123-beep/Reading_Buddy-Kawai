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

// ================== สัปดาห์นี้เทียบสัปดาห์ก่อน (ตัวเลข/กราฟจาก server ล้วน) + สรุป 7 วันแบบ AI ในส่วนพับได้ ==================

const WP_THAI_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
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

// ลูกศร + ข้อความเปลี่ยนแปลง: up = เขียว, down = ส้ม (ไม่ใช้แดง), flat = สีเทา
function wpDelta(el, dir, text) {
  const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "";
  el.className = `wp-kpi-delta is-${dir}`;
  el.textContent = arrow ? `${arrow} ${text}` : text;
}

function renderWeeklyKpis(p) {
  const now = p.thisWeek;
  const prev = p.lastWeek;
  document.getElementById("wpRange").textContent =
    `${wpShortDate(now.from)}–${wpShortDate(now.to)} เทียบ ${wpShortDate(prev.from)}–${wpShortDate(prev.to)}`;

  // ความเข้าใจ: เปลี่ยนแปลงเป็น "จุด" (ไม่ใช่ %) — ถ้าข้อมูลน้อยเกินไปโชว์ตัวเลขแต่เป็นสีเทา
  const acc = document.getElementById("wpAccDelta");
  document.getElementById("wpAcc").textContent = now.percent === null ? "–" : `${now.percent}%`;
  if (now.percent === null) wpDelta(acc, "flat", "สัปดาห์นี้ยังไม่ได้ตอบคำถาม");
  else if (prev.percent === null) wpDelta(acc, "flat", `ตอบ ${now.answered} ข้อ · สัปดาห์ก่อนไม่มีข้อมูล`);
  else {
    const diff = now.percent - prev.percent;
    const dir = p.trend === "up" ? "up" : p.trend === "down" ? "down" : "flat";
    const sign = diff > 0 ? "+" : diff < 0 ? "−" : "±";
    wpDelta(acc, dir, `${sign}${Math.abs(diff)} จุด จาก ${prev.percent}%${p.trend === "not_enough" ? " (ข้อมูลยังน้อย)" : ""}`);
  }

  const min = document.getElementById("wpMinDelta");
  document.getElementById("wpMin").textContent = `${now.minutes} นาที`;
  if (p.minutesChangePercent === null) wpDelta(min, "flat", now.minutes > 0 ? "สัปดาห์ก่อนไม่ได้อ่าน" : "ยังไม่ได้อ่าน");
  else {
    const c = p.minutesChangePercent;
    wpDelta(min, c > 0 ? "up" : c < 0 ? "down" : "flat", `${c > 0 ? "+" : c < 0 ? "−" : "±"}${Math.abs(c)}% จาก ${prev.minutes} นาที`);
  }

  const days = document.getElementById("wpDaysDelta");
  document.getElementById("wpDays").textContent = `${now.daysRead}/7 วัน`;
  const dd = now.daysRead - prev.daysRead;
  wpDelta(days, dd > 0 ? "up" : dd < 0 ? "down" : "flat", dd === 0 ? "เท่าสัปดาห์ก่อน" : `${dd > 0 ? "+" : "−"}${Math.abs(dd)} วัน`);
}

function renderWeeklyChart(p) {
  const dark = document.documentElement.classList.contains("dark-mode");
  const ink = dark ? "#b4b2a9" : "#6b6a65";
  const grid = dark ? "#33363b" : "#e1e0d9";
  const past = dark ? "#55585e" : "#d3d1c7";
  const current = p.trend === "down" ? (dark ? "#c98500" : "#eda100") : dark ? "#3987e5" : "#2a78d6";
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
          borderRadius: { topLeft: 4, topRight: 4 },
          borderSkipped: "bottom",
          maxBarThickness: 32,
        },
        {
          type: "line",
          data: labels.map(() => p.passPercent),
          borderColor: ink,
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
              return `ตอบถูก ${w.percent}% (${w.correct}/${w.answered} ข้อ)`;
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

// ข้อความ 1 ประโยค + ถ้าแย่ลง: บอกสาเหตุจากข้อมูลจริง และปุ่มทำต่อทันที (ทบทวนในเกม / อ่านบทที่ผิดบ่อยอีกรอบ)
function renderWeeklyMessage(p) {
  const box = document.getElementById("wpMessage");
  const now = p.thisWeek;
  const reviewLink = `<a class="wp-action" href="game.html">🎮 ทบทวนในเกม${p.reviewDue > 0 ? ` (${p.reviewDue} ข้อรอทบทวน)` : ""}</a>`;
  const toPass = now.percent !== null && now.percent < p.passPercent ? `อีก ${p.passPercent - now.percent} จุดถึงเกณฑ์ ${p.passPercent}%` : "";

  if (p.trend === "up") {
    box.className = "wp-message is-up";
    box.innerHTML = `<p>🐾 เก่งมาก! ตอบถูกเพิ่มขึ้น ${p.deltaPoints} จุด ${toPass || `ผ่านเกณฑ์ ${p.passPercent}% แล้ว`}</p>`;
    return;
  }
  if (p.trend === "steady") {
    box.className = "wp-message is-flat";
    box.innerHTML = `<p>🐾 ตอบถูกพอๆ กับสัปดาห์ก่อน (${now.percent}%)${toPass ? ` · ${toPass} ลองทบทวนข้อที่ยังผิดดูนะ` : " รักษาระดับนี้ไว้นะ"}</p>`;
    return;
  }
  if (p.trend === "not_enough") {
    box.className = "wp-message is-flat";
    box.innerHTML =
      `<p>🐾 สัปดาห์นี้ตอบคำถามไป ${now.answered} ข้อ ต้องมีอย่างน้อย ${p.minAnswers} ข้อทั้งสองสัปดาห์ถึงจะเทียบได้ชัด ลองเล่นด่านบทเรียนในเกมสัก 1 ด่านนะ</p>` +
      `<div class="wp-actions">${reviewLink}</div>`;
    return;
  }

  const reasons = [];
  if (p.readingDropped) reasons.push(`สัปดาห์นี้อ่านน้อยลง (${now.minutes} จาก ${p.lastWeek.minutes} นาที)`);
  if (p.weakChapter) reasons.push(`ตอบผิดบ่อยในบทที่ ${p.weakChapter.number} ${p.weakChapter.title} (${p.weakChapter.wrong} ข้อ)`);
  box.className = "wp-message is-down";
  box.innerHTML =
    `<p class="wp-message-title">⚠️ ความเข้าใจลดลง ${-p.deltaPoints} จุด</p>` +
    `<p>${reasons.length ? `น่าจะเพราะ${reasons.join(" และ")}` : "ลองทบทวนข้อที่ยังผิดแล้วกลับไปอ่านบทที่ไม่แน่ใจอีกรอบนะ"}</p>` +
    `<div class="wp-actions">${reviewLink}${
      p.weakChapter ? `<a class="wp-action" href="index.html?chapter=${p.weakChapter.number}">📖 อ่านบทที่ ${p.weakChapter.number} อีก 1 รอบ</a>` : ""
    }</div>`;
}

async function loadWeeklySummary() {
  const box = document.getElementById("weeklySummary");
  const note = document.getElementById("weeklySummaryNote");
  try {
    const data = await apiFetch("/analytics/weekly-summary");
    if (data.progress) {
      wpProgress = data.progress;
      renderWeeklyKpis(data.progress);
      renderWeeklyChart(data.progress);
      renderWeeklyMessage(data.progress);
    }
    const lines = data.summary.split("\n").map((l) => l.trim()).filter(Boolean);
    const bullets = lines.filter((l) => !l.startsWith("💡")).map((l) => l.replace(/^[-•*]\s*/, ""));
    const tips = lines.filter((l) => l.startsWith("💡"));
    box.innerHTML =
      (bullets.length ? `<ul>${bullets.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>` : "") +
      tips.map((l) => `<p class="weekly-summary-tip">${escapeHtml(l)}</p>`).join("");
    note.textContent =
      data.source === "ai"
        ? "เรียบเรียงโดย AI จากข้อมูลการอ่านจริงของคุณ (ตรวจตัวเลขแล้ว) · อัปเดตวันละครั้ง"
        : "สรุปจากข้อมูลการอ่านจริงของคุณ · อัปเดตวันละครั้ง";
  } catch (err) {
    console.error("โหลดสรุปการอ่านไม่สำเร็จ:", err);
    box.textContent = "ยังสรุปไม่ได้ตอนนี้ ลองใหม่อีกครั้งนะ";
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

  const labels = chapters.map((c) => `CH${c.chapter_number}`);
  const minutes = chapters.map((c) => secondsToMinutes(c.totalSeconds));
  // CH1-CH5 ใช้โทนสีตามลำดับ, CH6 ใช้เฉดพาสเทล (อ่อนกว่า) ของสีที่ 5
  const palette = ["#E2F0BD", "#8DB654", "#FBE577", "#FFBA18", "#DB5B23", "#F1BDA7"];

  new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: chapters.map((c) => `CH${c.chapter_number}: ${c.title}`),
      datasets: [
        {
          data: minutes,
          backgroundColor: chapters.map((_, i) => palette[i % palette.length]),
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } },
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
