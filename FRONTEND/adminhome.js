const CHART_COLORS = {
  green: "#8db754",
  grid: "rgba(0,0,0,0.08)",
  minutes: "#D9714E",
  minutesFill: "rgba(217, 113, 78, 0.55)",
  coins: "#F0B23D",
  coinsFill: "rgba(240, 178, 61, 0.55)",
};

const THAI_WEEKDAYS = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];

async function loadStats() {
  try {
    const data = await adminApiFetch("/admin/stats");
    document.getElementById("statTotalUsers").textContent = data.totalUsers.toLocaleString();
    document.getElementById("statOnlineUsers").textContent = data.onlineUsers.toLocaleString();
    document.getElementById("statTotalReadingHours").textContent = data.totalReadingHours.toLocaleString();
    document.getElementById("statTotalCoins").textContent = data.totalCoinsSpent.toLocaleString();
    document.getElementById("statMiniGamePlayers").textContent = data.gamePlayers.toLocaleString();
    renderChart(data.chart);
  } catch (err) {
    console.error("โหลดสถิติแอดมินไม่สำเร็จ:", err);
  }
}

function renderChart(chartRows) {
  const canvas = document.getElementById("dashboardChart");
  if (!canvas || typeof Chart === "undefined") return;

  // เติมวันที่ว่าง (ไม่มีข้อมูล) ให้ครบ 7 วันล่าสุด เรียงจากเก่าไปใหม่
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  const byDay = Object.fromEntries(chartRows.map((r) => [r.day, r]));

  new Chart(canvas, {
    type: "line",
    data: {
      labels: days.map((d) => THAI_WEEKDAYS[new Date(d).getDay()]),
      datasets: [
        {
          label: "คะแนนที่ได้ (coins)",
          data: days.map((d) => byDay[d]?.coins || 0),
          borderColor: CHART_COLORS.coins,
          backgroundColor: CHART_COLORS.coinsFill,
          fill: true,
          tension: 0,
          pointRadius: 0,
          borderWidth: 2,
        },
        {
          label: "เวลาอ่านรวม (นาที)",
          data: days.map((d) => byDay[d]?.minutes || 0),
          borderColor: CHART_COLORS.minutes,
          backgroundColor: CHART_COLORS.minutesFill,
          fill: true,
          tension: 0,
          pointRadius: 0,
          borderWidth: 2,
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

document.addEventListener("DOMContentLoaded", () => {
  if (!getAdminToken()) return; // adminAuth.js จะเด้งไป login ให้แล้ว
  loadStats();
});
