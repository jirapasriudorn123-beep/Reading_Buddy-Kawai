async function loadScores() {
  try {
    const { byCoins, byReading } = await adminApiFetch("/admin/scores");

    const coinBody = document.getElementById("coinScoreBody");
    coinBody.innerHTML = byCoins.length
      ? byCoins
          .map(
            (u, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${escapeHtml(u.username)}</td>
          <td>🪙 ${u.coins.toLocaleString()}</td>
        </tr>`
          )
          .join("")
      : `<tr><td colspan="3" style="text-align:center;color:#999;">ยังไม่มีข้อมูล</td></tr>`;

    const readingBody = document.getElementById("readingScoreBody");
    readingBody.innerHTML = byReading.length
      ? byReading
          .map(
            (u, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${escapeHtml(u.username)}</td>
          <td>${u.totalMinutes.toLocaleString()} นาที</td>
        </tr>`
          )
          .join("")
      : `<tr><td colspan="3" style="text-align:center;color:#999;">ยังไม่มีข้อมูล</td></tr>`;
  } catch (err) {
    console.error("โหลดอันดับไม่สำเร็จ:", err);
    alert("โหลดอันดับไม่สำเร็จ: " + err.message);
  }
}

// ================== คะแนนควิซแยกหมวด (วิชาสถาปัตย์คอมฯ / เกี่ยวกับสุนัข) ==================
// % คิดสะสมจากทุกครั้งที่ผู้เล่นเคยตอบคำถามในมินิเกม (ไม่ใช่แค่รอบล่าสุด)
// เกณฑ์ผ่าน/ไม่ผ่าน อิงจาก "คะแนนทั้งหมด" เท่านั้น — แถบคะแนนวิชา/สุนัขแยกไว้เป็นข้อมูลอ้างอิงเฉย ๆ

const DEFAULT_THRESHOLD = 80;
let allQuizScores = [];

async function loadQuizScores() {
  try {
    const { users } = await adminApiFetch("/admin/scores/quiz");
    allQuizScores = users;
    renderQuizScoreTable();
  } catch (err) {
    console.error("โหลดคะแนนควิซไม่สำเร็จ:", err);
    document.getElementById("quizScoreBody").innerHTML =
      '<tr><td colspan="6" style="text-align:center;color:#d9534f;">โหลดคะแนนไม่สำเร็จ</td></tr>';
  }
}

function currentThresholds() {
  return {
    subject: Number(document.getElementById("thresholdSubject").value) || 0,
    dog: Number(document.getElementById("thresholdDog").value) || 0,
    overall: Number(document.getElementById("thresholdOverall").value) || 0,
  };
}

function renderQuizScoreTable() {
  const search = document.getElementById("scoreSearchInput").value.trim().toLowerCase();
  const { overall } = currentThresholds();

  const filtered = search
    ? allQuizScores.filter(
        (u) =>
          u.username.toLowerCase().includes(search) || (u.email || "").toLowerCase().includes(search)
      )
    : allQuizScores;

  const body = document.getElementById("quizScoreBody");
  if (!filtered.length) {
    body.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#999;">ไม่พบข้อมูล</td></tr>';
    return;
  }

  body.innerHTML = filtered
    .map((u) => {
      const passed = u.overallPercent >= overall;
      return `
      <tr>
        <td>${escapeHtml(u.username)}</td>
        <td>${u.subjectPercent}%</td>
        <td>${u.dogPercent}%</td>
        <td>${u.overallPercent}%</td>
        <td><span class="qs-status-pill ${passed ? "pass" : "fail"}">${passed ? "ผ่าน" : "ไม่ผ่าน"}</span></td>
        <td>
          <button class="qs-detail-btn" onclick="openScoreDetail(${u.id})" title="ดูรายละเอียด">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </button>
        </td>
      </tr>`;
    })
    .join("");
}

function updateThresholdBars() {
  const { subject, dog, overall } = currentThresholds();
  document.getElementById("fillSubject").style.width = `${Math.min(100, Math.max(0, subject))}%`;
  document.getElementById("fillDog").style.width = `${Math.min(100, Math.max(0, dog))}%`;
  document.getElementById("fillOverall").style.width = `${Math.min(100, Math.max(0, overall))}%`;
}

function onThresholdChange() {
  updateThresholdBars();
  renderQuizScoreTable();
}

function resetThresholds() {
  document.getElementById("thresholdSubject").value = DEFAULT_THRESHOLD;
  document.getElementById("thresholdDog").value = DEFAULT_THRESHOLD;
  document.getElementById("thresholdOverall").value = DEFAULT_THRESHOLD;
  onThresholdChange();
}

function openScoreDetail(userId) {
  const u = allQuizScores.find((x) => x.id === userId);
  if (!u) return;
  const { overall } = currentThresholds();
  const passed = u.overallPercent >= overall;

  document.getElementById("scoreDetailTitle").textContent = "รายละเอียด";
  document.getElementById("scoreDetailBody").innerHTML = `
    <div class="qs-detail-header">
      <span>ชื่อผู้ใช้ : ${escapeHtml(u.username)}</span>
      <span class="qs-status-pill ${passed ? "pass" : "fail"}">${passed ? "ผ่าน" : "ไม่ผ่าน"}</span>
    </div>
    <div class="qs-detail-cards">
      <div class="qs-detail-card">
        <span class="qs-detail-card-label">คะแนนวิชาสถาปัตย์คอมฯ</span>
        <div class="qs-detail-card-score">${u.subjectPercent}<span class="qs-detail-card-max">/100</span></div>
      </div>
      <div class="qs-detail-card">
        <span class="qs-detail-card-label">คะแนนเกี่ยวกับสุนัข</span>
        <div class="qs-detail-card-score">${u.dogPercent}<span class="qs-detail-card-max">/100</span></div>
      </div>
    </div>
    <hr class="qs-detail-divider">
    <div class="qs-detail-summary">
      <p>คะแนนวิชาสถาปัตย์คอมฯ = ${u.subjectPercent}</p>
      <p>คะแนนเกี่ยวกับสุนัข = ${u.dogPercent}</p>
    </div>
    <p class="qs-detail-total">คะแนนทั้งหมด = ${u.overallPercent}</p>
  `;
  document.getElementById("scoreDetailModal").classList.add("active");
}

function closeScoreDetailModal() {
  document.getElementById("scoreDetailModal").classList.remove("active");
}

document.addEventListener("DOMContentLoaded", () => {
  if (!getAdminToken()) return;
  loadScores();
  loadQuizScores();
  updateThresholdBars();

  document.getElementById("scoreSearchInput").addEventListener("input", renderQuizScoreTable);
  document.getElementById("scoreDetailModal").addEventListener("click", function (e) {
    if (e.target === this) closeScoreDetailModal();
  });
});
