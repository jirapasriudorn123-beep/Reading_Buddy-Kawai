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
    renderUsersTrend(data.usersChangePercent, data.newSinceLastMonth);
    renderChart(data.chart);
  } catch (err) {
    console.error("โหลดสถิติแอดมินไม่สำเร็จ:", err);
  }
}

// อัปเดต pill "มากกว่าเดือนที่แล้ว X%" ให้เป็นตัวเลขจริงจาก backend
// - percent = null → ไม่มี baseline (เดือนที่แล้ว 0 user) → โชว์เป็นจำนวน user ใหม่แทน
// - percent > 0 → มากกว่า (📈)
// - percent < 0 → น้อยกว่า (📉)
// - percent = 0 → เท่าเดิม
function renderUsersTrend(percent, newSince) {
  const pill = document.getElementById("statUsersTrend");
  if (!pill) return;
  if (percent === null || percent === undefined) {
    pill.textContent = newSince > 0 ? `+${newSince} คนใหม่เดือนนี้ 📈` : "ยังไม่มี user 🐾";
    pill.className = "trend-pill";
    return;
  }
  if (percent > 0) {
    pill.textContent = `มากกว่าเดือนที่แล้ว ${percent}% 📈`;
    pill.className = "trend-pill trend-up";
  } else if (percent < 0) {
    pill.textContent = `น้อยกว่าเดือนที่แล้ว ${Math.abs(percent)}% 📉`;
    pill.className = "trend-pill trend-down";
  } else {
    pill.textContent = "เท่ากับเดือนที่แล้ว 🟰";
    pill.className = "trend-pill";
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

// ================== โหมดสาธิตจับเวลาอ่าน ==================
// เปิด: ขั้นต่ำ 1 นาที 10 คอยน์ทุก 1 นาที (ใช้ตอนนำเสนอ) — ปิด: 10 นาที 10 คอยน์ทุก 5 นาทีตามปกติ
let demoModeOn = false;

function renderDemoMode(rules) {
  demoModeOn = !!rules.demoMode;
  const card = document.getElementById("demoModeCard");
  const badge = document.getElementById("demoModeBadge");
  const desc = document.getElementById("demoModeDesc");
  const btn = document.getElementById("demoModeBtn");
  card.classList.toggle("on", demoModeOn);
  badge.textContent = demoModeOn ? "เปิดอยู่" : "ปิดอยู่";
  const presets = (rules.presets || []).map((p) => `${p.readMinutes}/${p.breakMinutes}`).join(" หรือ ");
  const rewardText = `ได้ ${rules.coinsPerBlock} คอยน์ทุก ${rules.minutesPerBlock} นาที`;
  desc.textContent = demoModeOn
    ? `ตอนนี้: รอบอ่าน ${presets} นาที · ${rewardText} · ไม่จำกัดรอบต่อวัน · อ่านบทละ ${rules.postTestMinReadMinutes} นาทีก็ทำแบบทดสอบหลังอ่านได้ — อย่าลืมปิดหลังสาธิต`
    : `ปกติ: รอบอ่าน Pomodoro ${presets} นาที · ${rewardText} · ได้คอยน์วันละไม่เกิน ${rules.dailyCoinRounds} รอบ`;
  btn.textContent = demoModeOn ? "ปิดโหมดสาธิต" : "เปิดโหมดสาธิต";
  btn.disabled = false;
}

async function loadDemoMode() {
  try {
    const { readingRules } = await adminApiFetch("/admin/demo-mode");
    renderDemoMode(readingRules);
  } catch (err) {
    console.error("โหลดสถานะโหมดสาธิตไม่สำเร็จ:", err);
  }
}

async function toggleDemoMode() {
  const turnOn = !demoModeOn;
  const question = turnOn
    ? "เปิดโหมดสาธิต? ผู้ใช้ทุกคนจะตั้งเวลาอ่านได้ตั้งแต่ 1 นาที และได้ 10 คอยน์ทุก 1 นาทีจนกว่าจะปิด"
    : "ปิดโหมดสาธิต? กลับเป็นขั้นต่ำ 10 นาที และ 10 คอยน์ทุก 5 นาที (เซสชันที่เริ่มไปแล้วยังใช้กติกาเดิมของมัน)";
  if (!confirm(question)) return;

  const btn = document.getElementById("demoModeBtn");
  btn.disabled = true;
  try {
    const { readingRules } = await adminApiFetch("/admin/demo-mode", {
      method: "PUT",
      body: JSON.stringify({ enabled: turnOn }),
    });
    renderDemoMode(readingRules);
  } catch (err) {
    alert("เปลี่ยนโหมดไม่สำเร็จ: " + err.message);
    btn.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (getAdminToken()) loadDemoMode();
});

// ================== ส่งออกข้อมูลวิจัย (CSV) ==================
// ต้องแนบ token แอดมินไปด้วย เลยโหลดผ่าน fetch แล้วค่อยสร้างลิงก์ดาวน์โหลดจากไฟล์ที่ได้
const RESEARCH_EXPORT_LABEL = { users: "รายคน", days: "รายวัน", sessions: "รายรอบอ่าน" };

async function downloadResearchCsv(kind) {
  const status = document.getElementById("researchExportStatus");
  status.textContent = `กำลังเตรียมไฟล์${RESEARCH_EXPORT_LABEL[kind]}...`;
  try {
    const response = await fetch(`${API_BASE_URL}/admin/export/${kind}`, {
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
    const disposition = response.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="([^"]+)"/);
    const filename = match ? match[1] : `reading-buddy-${kind}.csv`;

    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    status.textContent = `ดาวน์โหลด ${filename} แล้ว`;
  } catch (err) {
    status.textContent = err.message;
  }
}
