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

// ================== คะแนนแบบทดสอบก่อนอ่าน/หลังอ่าน (รายบท) ==================
// คะแนนหลักที่วัดว่าอ่านแล้วเข้าใจ — server คิดจากชุดแรกของแต่ละบท (มีทั้ง pre และ post)

let testScoreUsers = [];

function fmtPct(value) {
  return value === null || value === undefined ? "-" : `${value}%`;
}

function fmtGain(value) {
  if (value === null || value === undefined) return "-";
  const cls = value > 0 ? "gain-up" : value < 0 ? "gain-down" : "";
  return `<span class="${cls}">${value > 0 ? "+" : ""}${value}%</span>`;
}

// คืน HTML: วันที่อ่านล่าสุด + streak คนละบรรทัด (ตารางแคบจะได้ไม่ตัดกลางวันที่)
function fmtLastRead(u) {
  if (!u.lastReadDate) return '<span style="color:#999;">ยังไม่เคยอ่าน</span>';
  const date = new Date(u.lastReadDate + "T00:00:00").toLocaleDateString("th-TH", { dateStyle: "medium" });
  const line1 = `<span class="reading-line">${escapeHtml(date)}</span>`;
  return u.currentStreak > 0 ? `${line1}<br><span class="reading-line">🔥 ${u.currentStreak} วัน</span>` : line1;
}

async function loadTestScores() {
  try {
    const data = await adminApiFetch("/admin/scores/tests");
    testScoreUsers = data.users;
    document.getElementById("testPassPercent").textContent = data.passPercent;
    document.getElementById("testChapterBody").innerHTML = data.chapters
      .map(
        (c) => `
        <tr>
          <td>บทที่ ${c.chapterNumber} ${escapeHtml(c.title)}</td>
          <td>${c.preCount}</td>
          <td>${c.postCount}</td>
          <td>${fmtPct(c.avgPrePct)}</td>
          <td>${fmtPct(c.avgPostPct)}</td>
          <td>${fmtGain(c.avgGainPct)}</td>
          <td>${c.passedCount}</td>
        </tr>`
      )
      .join("");
    renderTestUserTable();
    fillReadingPageChapters(data.chapters);
  } catch (err) {
    console.error("โหลดคะแนนแบบทดสอบไม่สำเร็จ:", err);
    document.getElementById("testChapterBody").innerHTML =
      '<tr><td colspan="7" style="text-align:center;color:#d9534f;">โหลดคะแนนไม่สำเร็จ</td></tr>';
  }
}

function renderTestUserTable() {
  const term = document.getElementById("scoreSearchInput").value.trim().toLowerCase();
  const rows = testScoreUsers.filter(
    (u) => !term || u.username.toLowerCase().includes(term) || (u.email || "").toLowerCase().includes(term)
  );
  document.getElementById("testUserBody").innerHTML = rows.length
    ? rows
        .map(
          (u) => `
        <tr>
          <td>${escapeHtml(u.username)}</td>
          <td>${u.postCount}</td>
          <td>${fmtPct(u.avgPrePct)}</td>
          <td>${fmtPct(u.avgPostPct)}</td>
          <td>${fmtGain(u.avgGainPct)}</td>
          <td>${u.chaptersPassed}</td>
          <td>${fmtLastRead(u)}</td>
          <td>
            <button class="qs-detail-btn" onclick="openTestDetail(${u.id})" title="ดูแบบทดสอบรายบท">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </button>
          </td>
        </tr>`
        )
        .join("")
    : '<tr><td colspan="8" style="text-align:center;color:#999;">ไม่พบผู้ใช้</td></tr>';
}

const TEST_STATUS_LABEL = {
  pre_test: "กำลังทำก่อนอ่าน",
  reading: "กำลังอ่าน",
  post_test: "กำลังทำหลังอ่าน",
  completed: "ทำหลังอ่านแล้ว",
};

async function openTestDetail(userId) {
  const u = testScoreUsers.find((x) => x.id === userId);
  if (!u) return;
  const box = document.querySelector("#scoreDetailModal .edit-modal-box");
  box.classList.add("is-wide"); // ตารางนี้ 7 คอลัมน์ ใช้กล่องกว้าง
  document.getElementById("scoreDetailTitle").textContent = `แบบทดสอบของ ${u.username}`;
  document.getElementById("scoreDetailBody").innerHTML = '<p class="qs-stage-empty">กำลังโหลด...</p>';
  document.getElementById("scoreDetailModal").classList.add("active");
  try {
    const { tests } = await adminApiFetch(`/admin/scores/tests/${userId}`);
    document.getElementById("scoreDetailBody").innerHTML = tests.length
      ? `<div class="qs-detail-scroll"><table class="qs-test-detail">
          <thead><tr>
            <th>บท</th><th>ครั้งที่</th><th>สถานะ</th><th>ก่อนอ่าน</th><th>หลังอ่าน</th>
            <th>คอยน์<span>เวลา + โบนัส</span></th><th>ทำเสร็จเมื่อ</th>
          </tr></thead>
          <tbody>${tests
            .map((t) => {
              const done = t.status === "completed";
              return `
            <tr>
              <td class="qs-td-chapter">บทที่ ${t.chapterNumber}</td>
              <td>${t.attempt}${t.attempt > 1 ? '<span class="qs-again">อ่านซ้ำ</span>' : ""}</td>
              <td><span class="qs-status is-${done ? "done" : "doing"}">${escapeHtml(
                TEST_STATUS_LABEL[t.status] || t.status
              )}</span></td>
              <td>${t.preScore === null ? "–" : `${t.preScore}/${t.total}`}</td>
              <td>${done ? `${t.postScore}/${t.total}` : "–"}</td>
              <td>${done ? `${t.coinsTime} + ${t.coinsBonus}` : "–"}</td>
              <td class="qs-td-when">${done ? escapeHtml(formatThaiDate(t.completedAt)) : "–"}</td>
            </tr>`;
            })
            .join("")}</tbody>
        </table></div>`
      : '<p class="qs-stage-empty">ยังไม่เคยทำแบบทดสอบ</p>';
  } catch (err) {
    document.getElementById("scoreDetailBody").innerHTML = `<p class="qs-stage-empty">โหลดไม่สำเร็จ: ${escapeHtml(err.message)}</p>`;
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
      '<tr><td colspan="7" style="text-align:center;color:#d9534f;">โหลดคะแนนไม่สำเร็จ</td></tr>';
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
    body.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#999;">ไม่พบข้อมูล</td></tr>';
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
        <td>🪙 ${u.gameBonusCoins.toLocaleString()} <span style="color:#999;">(${u.gameStagesRewarded} ด่าน)</span></td>
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

// ตารางโบนัสคอยน์มินิเกมรายด่าน (โหลดแยกตอนเปิดหน้าต่างรายละเอียด)
async function loadStageRewards(userId) {
  const box = document.getElementById("stageRewardBox");
  try {
    const { stages } = await adminApiFetch(`/admin/scores/quiz/${userId}/stages`);
    if (!box.isConnected) return; // ปิด/เปิดหน้าต่างของคนอื่นไปแล้วระหว่างรอ
    box.innerHTML = stages.length
      ? `<table class="lesson-table qs-stage-table">
          <thead><tr><th>โลก</th><th>ด่าน</th><th>ดาว</th><th>คะแนน</th><th>คอยน์</th><th>วันที่ได้</th></tr></thead>
          <tbody>${stages
            .map(
              (s) => `<tr>
                <td>${s.world}</td>
                <td>${s.stage}</td>
                <td class="qs-stars">${"★".repeat(s.stars)}<span class="qs-stars-off">${"★".repeat(3 - s.stars)}</span></td>
                <td>${s.scorePercent}%</td>
                <td>🪙 +${s.coins}</td>
                <td>${escapeHtml(formatThaiDate(s.rewardedAt))}</td>
              </tr>`
            )
            .join("")}</tbody>
        </table>`
      : '<p class="qs-stage-empty">ยังไม่เคยได้โบนัสจากมินิเกม</p>';
  } catch (err) {
    console.error("โหลดโบนัสมินิเกมไม่สำเร็จ:", err);
    box.innerHTML = '<p class="qs-stage-empty" style="color:#d9534f;">โหลดข้อมูลไม่สำเร็จ</p>';
  }
}

// เวลาใน DB เป็น UTC ("YYYY-MM-DD HH:MM:SS") → แสดงเป็นเวลาไทย
function formatThaiDate(sqliteDatetime) {
  if (!sqliteDatetime) return "-";
  return new Date(sqliteDatetime.replace(" ", "T") + "Z").toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function openScoreDetail(userId) {
  const u = allQuizScores.find((x) => x.id === userId);
  if (!u) return;
  document.querySelector("#scoreDetailModal .edit-modal-box").classList.remove("is-wide");
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
    <hr class="qs-detail-divider">
    <p class="qs-stage-heading">
      โบนัสมินิเกม (ชนะด่านด้วยคะแนน 80% ขึ้นไป ได้ครั้งเดียวต่อด่าน) — รวม 🪙 ${u.gameBonusCoins.toLocaleString()}
    </p>
    <div id="stageRewardBox"><p class="qs-stage-empty">กำลังโหลด...</p></div>
  `;
  document.getElementById("scoreDetailModal").classList.add("active");
  loadStageRewards(userId);
}

function closeScoreDetailModal() {
  document.getElementById("scoreDetailModal").classList.remove("active");
}

// ================== การอ่านรายหน้า (PDF) ==================
// กราฟแท่ง = เวลาเฉลี่ยที่เปิดหน้านั้น (เฉลี่ยจากคนที่เปิดอ่านหน้านั้น) | เส้น = จำนวนคนที่เปิดอ่านหน้านั้น
// เลือกผู้ใช้ 1 คน = เวลาที่คนนั้นเปิดแต่ละหน้า (รวมทุกรอบอ่านของบทนี้)
let readingPagesData = null;
let readingPagesChart = null;

function fillReadingPageChapters(chapters) {
  const select = document.getElementById("rpChapter");
  if (!select || select.options.length) return;
  select.innerHTML = chapters
    .map((c) => `<option value="${c.id}">บทที่ ${c.chapterNumber} ${escapeHtml(c.title)}</option>`)
    .join("");
  loadReadingPages();
}

function formatSeconds(sec) {
  if (!sec) return "0 วินาที";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m} นาที${s ? ` ${s} วินาที` : ""}` : `${s} วินาที`;
}

async function loadReadingPages() {
  const chapterId = document.getElementById("rpChapter").value;
  if (!chapterId) return;
  const body = document.getElementById("rpUserBody");
  try {
    readingPagesData = await adminApiFetch(`/admin/reading-pages/${chapterId}`);
  } catch (err) {
    console.error("โหลดการอ่านรายหน้าไม่สำเร็จ:", err);
    body.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#d9534f;">โหลดข้อมูลไม่สำเร็จ</td></tr>';
    return;
  }
  const d = readingPagesData;
  document.getElementById("rpMinSeconds").textContent = d.viewedMinSeconds;

  const userSelect = document.getElementById("rpUser");
  userSelect.innerHTML =
    '<option value="">ทุกคน (เฉลี่ย)</option>' +
    d.users.map((u) => `<option value="${u.id}">${escapeHtml(u.username)}</option>`).join("");

  body.innerHTML = d.users.length
    ? d.users
        .map(
          (u) => `
        <tr>
          <td>${escapeHtml(u.username)}</td>
          <td>${u.pagesViewed} / ${d.chapter.totalPages || "-"} หน้า${u.coveragePct != null ? ` <span class="rp-coverage">(${u.coveragePct}%)</span>` : ""}</td>
          <td>${u.lastPage ?? "-"}</td>
          <td>${u.minutes} นาที</td>
          <td>${fmtPct(u.prePct)}</td>
          <td>${fmtPct(u.postPct)}</td>
          <td>
            <button class="qs-detail-btn" onclick="showReadingPagesFor(${u.id})" title="ดูกราฟรายหน้าของคนนี้">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="6" y1="20" x2="6" y2="12"/><line x1="12" y1="20" x2="12" y2="6"/><line x1="18" y1="20" x2="18" y2="14"/>
              </svg>
            </button>
          </td>
        </tr>`
        )
        .join("")
    : '<tr><td colspan="7" style="text-align:center;color:#999;">ยังไม่มีใครอ่านบทนี้ผ่าน PDF</td></tr>';

  renderReadingPagesChart();
}

function showReadingPagesFor(userId) {
  document.getElementById("rpUser").value = String(userId);
  renderReadingPagesChart();
  document.querySelector(".rp-panel").scrollIntoView({ behavior: "smooth", block: "center" });
}

function renderReadingPagesChart() {
  const d = readingPagesData;
  if (!d) return;
  const userId = Number(document.getElementById("rpUser").value) || null;
  const user = userId ? d.users.find((u) => u.id === userId) : null;
  const empty = !d.pages.length || !d.users.length;
  document.getElementById("rpEmpty").hidden = !empty;
  document.querySelector(".rp-chart-wrap").hidden = empty;

  const summary = document.getElementById("rpSummary");
  if (empty) {
    summary.textContent = "";
  } else if (user) {
    summary.textContent = `${user.username}: เปิดอ่าน ${user.pagesViewed}/${d.chapter.totalPages} หน้า · ${user.minutes} นาที`;
  } else {
    const avgPages = d.users.reduce((a, u) => a + u.pagesViewed, 0) / d.users.length;
    summary.textContent = `อ่านแล้ว ${d.users.length} คน · เปิดอ่านเฉลี่ย ${avgPages.toFixed(1)}/${d.chapter.totalPages} หน้า`;
  }

  if (readingPagesChart) {
    readingPagesChart.destroy();
    readingPagesChart = null;
  }
  if (empty || typeof Chart === "undefined") return;

  const labels = d.pages.map((p) => p.page);
  const seconds = user ? d.pages.map((p) => user.pages[p.page] || 0) : d.pages.map((p) => p.avgSeconds);
  const datasets = [
    {
      type: "bar",
      label: user ? `เวลาที่ ${user.username} เปิดหน้านี้ (วินาที)` : "เวลาเฉลี่ยต่อหน้า (วินาที)",
      data: seconds,
      backgroundColor: "rgba(151, 188, 98, 0.75)",
      borderRadius: 4,
      yAxisID: "y",
    },
  ];
  if (!user) {
    datasets.push({
      type: "line",
      label: "จำนวนคนที่เปิดอ่านหน้านี้",
      data: d.pages.map((p) => p.readers),
      borderColor: "#e0892f",
      backgroundColor: "#e0892f",
      pointRadius: 2,
      tension: 0.25,
      yAxisID: "y1",
    });
  }

  readingPagesChart = new Chart(document.getElementById("rpChart"), {
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          callbacks: {
            title: (items) => `หน้า ${items[0].label}`,
            label: (item) =>
              item.dataset.yAxisID === "y"
                ? `${item.dataset.label.replace(" (วินาที)", "")}: ${formatSeconds(item.raw)}`
                : `${item.dataset.label}: ${item.raw} คน`,
          },
        },
      },
      scales: {
        x: { title: { display: true, text: "หน้า" } },
        y: { beginAtZero: true, title: { display: true, text: "วินาที" } },
        ...(user
          ? {}
          : {
              y1: {
                beginAtZero: true,
                position: "right",
                grid: { drawOnChartArea: false },
                ticks: { precision: 0 },
                title: { display: true, text: "คน" },
              },
            }),
      },
    },
  });
}

document.addEventListener("DOMContentLoaded", () => {
  if (!getAdminToken()) return;
  loadScores();
  loadTestScores();
  loadQuizScores();
  updateThresholdBars();

  document.getElementById("scoreSearchInput").addEventListener("input", () => {
    renderQuizScoreTable();
    renderTestUserTable();
  });
  document.getElementById("scoreDetailModal").addEventListener("click", function (e) {
    if (e.target === this) closeScoreDetailModal();
  });
});
