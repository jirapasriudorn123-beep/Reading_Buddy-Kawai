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
      loadWeeklyProgress(),
      loadFocusChart(),
      loadTrendChart(),
    ]);
  } catch (err) {
    console.error("โหลดข้อมูล Dashboard ไม่สำเร็จ:", err);
  }
});

// ================== ผู้ใช้ + เหรียญ ==================

async function loadUserInfo() {
  const { user } = await apiFetch("/auth/me");
  document.getElementById("coinAmount").textContent = user.coins;
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
