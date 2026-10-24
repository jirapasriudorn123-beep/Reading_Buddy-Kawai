// ================== ตัวช่วยเรียก API ==================

function getToken() {
  return localStorage.getItem("token");
}

// URL รากของ backend (ไม่มี /api ต่อท้าย) ใช้สร้าง URL เต็มของรูปโปรไฟล์ที่อัปโหลดไว้
const UPLOADS_BASE_URL = API_BASE_URL.replace(/\/api\/?$/, "");

// เรียก API พร้อมแนบ token อัตโนมัติ ถ้า token หมดอายุ/ไม่ถูกต้อง จะเด้งไปหน้า login ให้เอง
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
    // token หมดอายุหรือไม่ถูกต้อง เคลียร์แล้วเด้งกลับไป login
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

// ================== ตัวแปร state หลักของหน้า ==================

let currentGoal = { goal_minutes: 0, goal_seconds: 0 };
let chaptersData = []; // บทเรียน + สถานะการอ่าน/แบบทดสอบของผู้ใช้ (progress) จาก /chapters
let selectedChapter = null; // chapter ที่กำลังเปิด modal เลือกรอบอ่านอยู่
let selectedPresetId = null; // รอบ Pomodoro ที่ใช้ ("25" = อ่าน 25 พัก 5 — มีแบบเดียว ถ้าเพิ่มแบบอื่นใน readingRules จะขึ้นให้เลือก)
let activeSession = null; // { id, chapterId, plannedReadSeconds, plannedBreakSeconds }
let countdownInterval = null;
let remainingSeconds = 0;
let onBreak = false; // true ระหว่างช่วงพักหลังอ่านจบ (session จบไปแล้ว รอนับเวลาพักอย่างเดียว)
let breakCountdownInterval = null;
let breakEndsAt = 0; // เวลาที่พักครบ (นับตามนาฬิกาจริง พักต่อแม้สลับแท็บ)
// บทที่อ่านรอบล่าสุด + streak ล่าสุด (ใช้ตอนพักครบ: ปุ่ม "อ่านรอบต่อไป" และสรุปวันนี้)
let lastRoundChapter = null;
let lastRoundStreak = null;
// 'reading' ระหว่างนับเวลาอ่าน | null = ไม่ได้อ่านอยู่ (แบบทดสอบก่อน/หลังอ่านแยกไปอยู่ในตัวแปร quiz)
let sessionPhase = null;

// กติกาเวลาอ่าน (backend ส่งมากับ /chapters): รอบ Pomodoro ที่เลือกได้ + คอยน์ต่อเวลา + โควต้ารอบต่อวัน
let readingRules = { demoMode: false, presets: [], minutesPerBlock: 5, coinsPerBlock: 10, roundsUsed: null, roundsCap: null };

// ================== เริ่มทำงานเมื่อโหลดหน้า ==================

document.addEventListener("DOMContentLoaded", async () => {
  // ต้อง login ก่อนถึงจะดูหน้านี้ได้
  if (!getToken()) {
    window.location.href = "login.html";
    return;
  }

  try {
    await Promise.all([loadUserInfo(), loadGoal(), loadChapters()]);
  } catch (err) {
    console.error("โหลดข้อมูลหน้า Dashboard ไม่สำเร็จ:", err);
  }

  bindStaticEventListeners();
  // ลิงก์จากแดชบอร์ด "อ่านบทที่ N อีก 1 รอบ" (index.html?chapter=N) → เปิดหน้าต่างเริ่มอ่านบทนั้นเลย
  const chapterParam = Number(new URLSearchParams(location.search).get("chapter"));
  if (chapterParam) {
    history.replaceState(null, "", location.pathname);
    const chapter = chaptersData.find((c) => c.chapter_number === chapterParam);
    if (chapter) openChapterTimeModal(chapter);
  }
  // คำแนะนำการใช้งาน (ครั้งแรกที่เข้าหน้านี้) — รอปุ่มแชทบอท (chat.js) สร้างเสร็จก่อน
  // ปุ่ม ? ระหว่างเปิดหน้าอ่านอยู่ ให้เปิดคำแนะนำของหน้าอ่าน
  setTourKeyResolver(() => (document.getElementById("readerView").style.display === "none" ? "home" : "reader"));
  setTimeout(() => startPageTour("home"), 300);
});

// ================== ผู้ใช้ + เหรียญ ==================

async function loadUserInfo() {
  const { user } = await apiFetch("/auth/me");
  document.getElementById("usernameDisplay").textContent = user.username;
  updateCoinBadge(user.coins);
  localStorage.setItem("currentUser", user.username);
}

function updateCoinBadge(coins) {
  document.getElementById("coinAmount").textContent = coins;
}

// ================== เป้าหมายเวลาอ่าน ==================

async function loadGoal() {
  const { goal } = await apiFetch("/goal");
  currentGoal = goal;
  updateGoalButtonState();
}

// ปุ่มเป็นสีครีมถ้ายังไม่เคยตั้งเป้าหมาย และเปลี่ยนเป็นสีเขียวทันทีที่ตั้งเป้าหมายแล้ว
function updateGoalButtonState() {
  const btn = document.getElementById("openModalBtn");
  if (!btn) return;
  const hasGoal = (currentGoal.goal_minutes || 0) > 0 || (currentGoal.goal_seconds || 0) > 0;
  btn.classList.toggle("goal-set", hasGoal);
}

function openGoalModal() {
  document.getElementById("minutesInput").value = currentGoal.goal_minutes || "";
  document.getElementById("secondsInput").value = currentGoal.goal_seconds || "";
  document.getElementById("goalError").style.display = "none";
  document.getElementById("goalModal").style.display = "flex";
}

function closeGoalModal() {
  document.getElementById("goalModal").style.display = "none";
}

async function submitGoal() {
  const minutes = Number(document.getElementById("minutesInput").value);
  const seconds = Number(document.getElementById("secondsInput").value);
  const errorEl = document.getElementById("goalError");
  errorEl.style.display = "none";

  try {
    const result = await apiFetch("/goal", {
      method: "PUT",
      body: JSON.stringify({ minutes, seconds }),
    });
    currentGoal = result.goal;
    updateGoalButtonState();
    closeGoalModal();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = "block";
  }
}

// ================== Chapters ==================

async function loadChapters() {
  const data = await apiFetch("/chapters");
  if (data.readingRules) readingRules = data.readingRules;
  chaptersData = data.chapters;
  renderChapters(data.chapters);
  loadReviewBanner();
}

// ทบทวนแบบเว้นระยะ: วันนี้มีข้อถึงรอบกี่ข้อ (ข้อที่ตอบผิด / ครบ 1-3-7-14 วันหลังตอบถูก) → ป้ายชวนไปทบทวนในเกม
async function loadReviewBanner() {
  const banner = document.getElementById("reviewBanner");
  if (!banner) return;
  try {
    const review = await apiFetch("/game/review");
    const due = review.chapters.filter((c) => c.due > 0);
    if (!review.dueTotal) {
      banner.style.display = "none";
      return;
    }
    const detail = due.map((c) => `บทที่ ${c.chapterNumber}: ${c.due} ข้อ`).join(" · ");
    banner.innerHTML =
      `<span class="review-banner-icon">🔁</span>` +
      `<span class="review-banner-text"><strong>วันนี้มี ${review.dueTotal} ข้อถึงรอบทบทวน</strong>` +
      `<small>${escapeHtml(detail)}</small></span>` +
      `<span class="review-banner-go">ไปทบทวนในเกม ›</span>`;
    banner.style.display = "";
  } catch (err) {
    banner.style.display = "none";
  }
}

// ป้ายสถานะใต้รูปบนการ์ดบท: อ่านค้างไว้ (เริ่มชุดแล้วแต่ยังไม่ทำแบบทดสอบหลังอ่าน) | อ่านไปแล้ว (ทำแบบทดสอบหลังอ่านจบอย่างน้อย 1 ครั้ง)
// อ่านซ้ำบทที่อ่านไปแล้วจนเปิดชุดใหม่ = อ่านค้างไว้ (ชุดล่าสุดยังไม่จบ) | รายละเอียด (พร้อมทำแบบทดสอบ ฯลฯ) อยู่ในป๊อปอัพตอนกดการ์ด
function chapterBadge(progress) {
  if (!progress || progress.status === "none") return null;
  if (progress.status === "completed") return { text: "✅ อ่านไปแล้ว", kind: "done" };
  return { text: "📖 อ่านค้างไว้", kind: "in-progress" };
}

function renderChapters(chapters) {
  const grid = document.getElementById("chapterGrid");
  grid.innerHTML = "";

  chapters.forEach((chapter, index) => {
    const colorClass = `card-ch${(index % 6) + 1}`;

    const card = document.createElement("div");
    card.className = `chapter-card ${colorClass}`;
    card.dataset.chapterId = chapter.id;
    card.dataset.chapterTitle = chapter.title;
    // ไอคอนบทเรียนอยู่ที่ img/chapters/{เลขบท}.png (มีเฉพาะบท 1-6 ตอนนี้)
    // ถ้ามีบทเพิ่มในอนาคตแล้วรูปไม่มี ให้ fallback เป็นอิโมจิสลับ
    const iconHtml = `
    <img src ="img/chapters/${chapter.chapter_number}.png" 
    alt="Chapter ${chapter.chapter_number}" 
    class="chapter-icon"
    onerror="this.onerror=null;this.src='img/chapters/default.png';"
    >
    `; 
      
    const badge = chapterBadge(chapter.progress);
    card.innerHTML = `
      <div class="card-inner">
        <div class="chapter-label">CHAPTER ${chapter.chapter_number}</div>
        <p class="chapter-desc">${escapeHtml(chapter.title)}</p>
        <div class="card-icon">${iconHtml}</div>
        ${badge ? `<div class="chapter-badge ${badge.kind}">${badge.text}</div>` : ""}
      </div>
    `;
    card.addEventListener("click", () => openChapterTimeModal(chapter));
    grid.appendChild(card);
  });
}

// ================== หน้าต่างอ่านหนังสือ (ขั้น 1: ตั้งเวลา → ขั้น 2: อ่าน PDF) ==================

// เผยแพร่เป็น global ให้ chat.js อ่านได้ ว่าตอนนี้กำลังอ่าน chapter ไหนอยู่ (ใช้เป็น context ให้แชทบอท)
window.currentReadingChapterTitle = null;
window.currentReadingChapterId = null;

// ---- ขั้น 1: ป๊อปอัพเลือกรอบอ่าน (Pomodoro) + สถานะการอ่าน/แบบทดสอบของบทนี้ ----

function formatMinutes(seconds) {
  return `${Math.floor(seconds / 60)} นาที`;
}

// อ่านบทเดิมซ้ำ (ชุดที่ 2 ขึ้นไป) ไม่มีแบบทดสอบก่อนอ่าน — บอกให้ชัดว่าทำแค่ครั้งแรก
function rereadLine(attemptNo) {
  return `🔁 อ่านบทนี้ครั้งที่ ${attemptNo} — ไม่มีแบบทดสอบก่อนอ่าน (ทำครั้งเดียวตอนอ่านครั้งแรก)`;
}

function chapterStatusLines(progress) {
  if (!progress || progress.status === "none" || progress.status === "pre_test") {
    return ["📝 อ่านบทนี้ครั้งแรก: ทำแบบทดสอบก่อนอ่าน 10 ข้อ (ข้อละ 1 นาที) ก่อนนะ ไม่มีผลกับคอยน์"];
  }
  if (progress.status === "post_test") {
    return ["📝 ทำแบบทดสอบหลังอ่านค้างอยู่ ทำให้เสร็จก่อนอ่านต่อนะ (ข้อที่เปิดค้างไว้จนหมดเวลานับว่าผิด)"];
  }
  if (progress.status === "reading") {
    const failedLine = progress.postTries > 0
      ? [`📝 แบบทดสอบหลังอ่านครั้งล่าสุดได้ ${progress.lastPostScore}/${progress.total} ยังไม่ผ่าน (ต้องได้ ${progress.passScore} ขึ้นไป) ทำใหม่ได้เลย หรืออ่านทบทวนก่อนก็ได้`]
      : [];
    return [
      ...(progress.attempt >= 2 ? [rereadLine(progress.attempt)] : []),
      ...failedLine,
      `📖 อ่านบทนี้แล้ว ${formatMinutes(progress.readSeconds)} / ${formatMinutes(progress.minReadSeconds)} · ` +
        `คอยน์รอปลดล็อก ${progress.pendingCoins} <img src="img/coin_ja.png" alt="คอยน์" class="coin-inline">`,
      progress.canPostTest
        ? `✅ อ่านครบแล้ว! ทำแบบทดสอบหลังอ่าน ได้ ${progress.passScore}/${progress.total} ขึ้นไปถึงจะผ่านและได้คอยน์ + โบนัสข้อที่ตอบถูก`
        : `คอยน์จะเข้าเมื่อทำแบบทดสอบหลังอ่านผ่าน (${progress.passScore}/${progress.total} ขึ้นไป · อ่านครบเวลาก่อนถึงจะทำได้)`,
      ...rewardLimitLines(progress),
    ];
  }
  // completed = อ่านซ้ำ (ชุดใหม่ ไม่มีแบบทดสอบก่อนอ่าน)
  const best = progress.bestPostScore != null ? ` (หลังอ่านดีที่สุด ${progress.bestPostScore}/${progress.total})` : "";
  return [
    rereadLine(progress.attempt + 1),
    `${progress.passed ? "✅ ผ่านบทนี้แล้ว" : "อ่านบทนี้จบไปแล้ว"}${best} · ข้อที่เคยตอบผิดจะถูกถามก่อนในแบบทดสอบหลังอ่าน`,
    ...rewardLimitLines(progress),
  ];
}

// ได้คอยน์จากบทหนึ่งสูงสุด 4 ครั้ง (นับครั้งที่ทำแบบทดสอบหลังอ่านผ่าน)
function rewardLimitLines(progress) {
  if (!progress.coinRewardsMax) return [];
  if (progress.coinRewardsLeft === 0) {
    return [`<img src="img/coin_ja.png" alt="คอยน์" class="coin-inline"> บทนี้ได้คอยน์ครบ ${progress.coinRewardsMax} ครั้งแล้ว อ่านทบทวน/ทำแบบทดสอบได้ แต่ไม่ได้คอยน์เพิ่ม`];
  }
  return progress.coinRewardsUsed > 0
    ? [`<img src="img/coin_ja.png" alt="คอยน์" class="coin-inline"> ได้คอยน์จากบทนี้แล้ว ${progress.coinRewardsUsed}/${progress.coinRewardsMax} ครั้ง`]
    : [];
}

function renderPresetButtons() {
  const group = document.getElementById("presetGroup");
  const label = document.getElementById("presetLabel");
  // มีรอบเวลาแบบเดียว: โชว์เป็นข้อความ ไม่ต้องให้เลือก
  if (readingRules.presets.length === 1) {
    const p = readingRules.presets[0];
    label.textContent = `รอบอ่านแบบ Pomodoro: อ่าน ${p.readMinutes} นาที · พัก ${p.breakMinutes} นาที`;
    group.innerHTML = "";
    return;
  }
  label.textContent = "เลือกรอบอ่านแบบ Pomodoro";
  group.innerHTML = readingRules.presets
    .map(
      (p) => `
        <button type="button" class="preset-btn${p.id === selectedPresetId ? " is-selected" : ""}" data-preset="${escapeHtml(p.id)}"
                aria-pressed="${p.id === selectedPresetId}">
          <span class="preset-read">อ่าน ${p.readMinutes} นาที</span>
          <span class="preset-break">พัก ${p.breakMinutes} นาที</span>
        </button>`
    )
    .join("");
  group.querySelectorAll(".preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedPresetId = btn.dataset.preset;
      renderPresetButtons();
    });
  });
}

function openChapterTimeModal(chapter) {
  if (activeSession || quiz) {
    alert("คุณกำลังอ่านหรือทำแบบทดสอบอยู่ กรุณาทำให้เสร็จก่อน");
    return;
  }

  selectedChapter = chapter;
  const progress = chapter.progress;
  document.getElementById("modalChapterTitle").textContent = `Chapter ${chapter.chapter_number} ${chapter.title}`;

  const demoNotice = document.getElementById("demoModeNotice");
  if (demoNotice) {
    demoNotice.style.display = readingRules.demoMode ? "block" : "none";
    demoNotice.textContent = `🧪 โหมดสาธิต: รอบสั้นพิเศษ · อ่านทุก ${readingRules.minutesPerBlock} นาทีได้ ${readingRules.coinsPerBlock} คอยน์`;
  }

  // บรรทัดสถานะเป็นข้อความที่เราเขียนเอง (มีแต่ตัวเลขของระบบ + รูปคอยน์) เลยใส่ลง innerHTML ได้ตรงๆ
  document.getElementById("chapterStatus").innerHTML = chapterStatusLines(progress)
    .map((line) => `<p>${line}</p>`)
    .join("");

  if (!readingRules.presets.some((p) => p.id === selectedPresetId)) {
    selectedPresetId = readingRules.presets.length ? readingRules.presets[0].id : null;
  }
  renderPresetButtons();

  const roundsNote = document.getElementById("dailyRoundsNote");
  if (readingRules.roundsCap) {
    const full = readingRules.roundsUsed >= readingRules.roundsCap;
    roundsNote.textContent = full
      ? `วันนี้ได้คอยน์จากการอ่านครบ ${readingRules.roundsCap}/${readingRules.roundsCap} รอบแล้ว อ่านต่อได้ แต่รอบต่อไปจะไม่ได้คอยน์ (พรุ่งนี้ได้ใหม่)`
      : `วันนี้ได้คอยน์จากการอ่านแล้ว ${readingRules.roundsUsed}/${readingRules.roundsCap} รอบ`;
    roundsNote.style.display = "";
  } else {
    roundsNote.style.display = "none";
  }

  const busyWithPost = progress && progress.status === "post_test";
  document.getElementById("startReadingBtn").disabled = busyWithPost;
  document.getElementById("presetGroup").style.display = busyWithPost ? "none" : "";
  document.getElementById("presetLabel").style.display = busyWithPost ? "none" : "";
  const postBtn = document.getElementById("postTestBtn");
  postBtn.style.display = progress && progress.canPostTest ? "" : "none";
  postBtn.textContent = busyWithPost ? "📝 ทำแบบทดสอบหลังอ่านต่อ" : "📝 ทำแบบทดสอบหลังอ่าน";
  document.getElementById("chapterError").style.display = "none";

  document.getElementById("chapterModal").style.display = "flex";
}

function closeChapterModal() {
  document.getElementById("chapterModal").style.display = "none";
  selectedChapter = null;
}

async function confirmStartReading() {
  const errorEl = document.getElementById("chapterError");
  errorEl.style.display = "none";
  if (!selectedChapter) return;
  if (!selectedPresetId) {
    errorEl.textContent = "กรุณาเลือกรอบเวลาอ่าน";
    errorEl.style.display = "block";
    return;
  }

  const chapter = selectedChapter;
  try {
    await startReadingRound(chapter);
  } catch (err) {
    // อ่านบทนี้ครั้งแรก: ต้องทำแบบทดสอบก่อนอ่านก่อน แล้วค่อยเริ่มนับเวลา
    if (err.data && err.data.code === "PRE_TEST_REQUIRED") {
      document.getElementById("chapterModal").style.display = "none";
      runChapterTest(chapter, "pre", () => startReadingRound(chapter).catch((e) => alert(e.message)));
      return;
    }
    errorEl.textContent = err.message;
    errorEl.style.display = "block";
  }
}

async function startReadingRound(chapter) {
  const result = await apiFetch(`/chapters/${chapter.id}/sessions`, {
    method: "POST",
    body: JSON.stringify({ presetId: selectedPresetId }),
  });
  activeSession = {
    id: result.session.id,
    chapterId: chapter.id,
    plannedReadSeconds: result.session.plannedReadSeconds,
    plannedBreakSeconds: result.session.plannedBreakSeconds,
  };
  document.getElementById("chapterModal").style.display = "none";
  sessionPhase = "reading";
  // คำแนะนำหน้าอ่าน (ครั้งแรกที่อ่าน) — รอตัวแสดง PDF โหลดเสร็จ แถบเปลี่ยนหน้า/ซูมจะได้ขึ้นแล้ว
  openReaderView(chapter, result.session.resumePage).then(() => startPageTour("reader"));
  startPageTracking();
  updateBreakClockDisplay(activeSession.plannedBreakSeconds); // โชว์เวลาพักของรอบนี้ไว้ล่วงหน้า (นับถอยหลังหลังอ่านจบ)
  startCountdown(activeSession.plannedReadSeconds);
  keepScreenOn(); // กันจอดับระหว่างอ่าน (จอดับ = ถูกนับเป็นเวลาที่ออกจากหน้าอ่าน)
}

// ปุ่ม "ทำแบบทดสอบหลังอ่าน" ในป๊อปอัพบท (อ่านครบเวลาขั้นต่ำของบทแล้ว)
function startPostTestFromModal() {
  if (!selectedChapter) return;
  const chapter = selectedChapter;
  document.getElementById("chapterModal").style.display = "none";
  runChapterTest(chapter, "post", () => {});
}

// ---- ขั้น 2: หน้าจออ่าน PDF พร้อมนาฬิกานับถอยหลัง (แทนที่การ์ด chapter ในหน้าเดิม เปิดหลังกด "เริ่มจับเวลา" แล้วเท่านั้น) ----

// คืน promise ที่เสร็จเมื่อโหลด PDF เสร็จ
function openReaderView(chapter, resumePage) {
  window.currentReadingChapterTitle = `CHAPTER ${chapter.chapter_number}: ${chapter.title}`;
  window.currentReadingChapterId = chapter.id;

  const pdfReady = loadReaderPdf(chapter, resumePage);
  document.getElementById("readerError").style.display = "none";

  onBreak = false;
  const btn = document.getElementById("readerStartStopBtn");
  btn.textContent = "หยุด";
  btn.classList.remove("on-break");
  btn.classList.add("is-running");

  document.querySelector(".main-title").style.display = "none";
  document.getElementById("chapterScrollWrapper").style.display = "none";
  document.getElementById("readerView").style.display = "flex";
  return pdfReady;
}

function closeReaderView() {
  document.getElementById("readerView").style.display = "none";
  document.querySelector(".main-title").style.display = "";
  document.getElementById("chapterScrollWrapper").style.display = "";
}

// URL ไฟล์ PDF ของบท: แอดมินอัปโหลดไว้ (Cloudinary = URL เต็ม / ไฟล์ใน backend = path) ไม่งั้นใช้ไฟล์ตามเลขบทในเว็บ
function chapterPdfUrl(chapter) {
  if (!chapter.pdf_url) return `pdf/chapter-${chapter.chapter_number}.pdf`;
  if (/^https?:\/\//i.test(chapter.pdf_url)) return chapter.pdf_url;
  return `${API_BASE_URL.replace(/\/api\/?$/, "")}${chapter.pdf_url}`;
}

function showPdfMode(mode) {
  document.getElementById("readerPdfViewer").style.display = mode === "viewer" ? "" : "none";
  document.getElementById("pdfToolbar").style.display = mode === "viewer" ? "" : "none";
  document.getElementById("readerPdfFrame").style.display = mode === "frame" ? "block" : "none";
  document.getElementById("readerPdfPlaceholder").style.display = mode === "missing" ? "flex" : "none";
}

// เปิด PDF ของบทด้วย PDF.js (เปิดต่อจากหน้าเดิมของครั้งก่อน) — ไลบรารีโหลดไม่ได้/เปิดไฟล์ไม่ได้ กลับไปใช้ตัวแสดงของเบราว์เซอร์ (iframe)
// เช็คก่อนว่ามีไฟล์จริงไหม (บทที่ยังไม่ได้อัปโหลด โชว์ข้อความแทนหน้าจอ error) — fetch ใช้ได้เฉพาะตอนเปิดผ่าน http/https
async function loadReaderPdf(chapter, resumePage) {
  const frame = document.getElementById("readerPdfFrame");
  const pdfPath = chapterPdfUrl(chapter);

  let available = true;
  if (location.protocol !== "file:") {
    try {
      const res = await fetch(pdfPath, { method: "HEAD" });
      available = res.ok;
    } catch {
      available = false;
    }
  }
  if (!available) {
    pdfTotalPages = 0;
    frame.src = "";
    showPdfMode("missing");
    return;
  }

  if (pdfReaderAvailable()) {
    try {
      showPdfMode("viewer");
      frame.src = "";
      pdfTotalPages = await openPdfReader(pdfPath, { startPage: resumePage || 1 });
      return;
    } catch (err) {
      console.warn("เปิด PDF ด้วย PDF.js ไม่สำเร็จ ใช้ตัวแสดงของเบราว์เซอร์แทน:", err);
      closePdfReader();
    }
  }
  pdfTotalPages = 0; // ตัวแสดงของเบราว์เซอร์บอกไม่ได้ว่าอยู่หน้าไหน — ไม่นับเวลาต่อหน้า
  frame.src = pdfPath;
  showPdfMode("frame");
}

// ================== นับเวลาที่เปิดแต่ละหน้า (หลักฐานเสริมว่าอ่าน ไม่มีผลกับคอยน์) ==================
// นับเฉพาะตอนจับเวลาอ่านอยู่และหน้าเว็บแสดงอยู่ | ส่งยอดสะสมให้ server ทุก 30 วินาที ตอนสลับแท็บ และตอนจบรอบ

const PAGE_FLUSH_SECONDS = 30;
let pdfTotalPages = 0;
let pageTime = {};
let pageTickTimer = null;
let pageFlushTimer = null;

function startPageTracking() {
  stopPageTracking();
  pageTime = {};
  pageTickTimer = setInterval(() => {
    if (!activeSession || sessionPhase !== "reading" || document.hidden || !pdfTotalPages || idlePromptOpen) return;
    const page = currentPdfPage();
    if (page) pageTime[page] = (pageTime[page] || 0) + 1;
  }, 1000);
  pageFlushTimer = setInterval(() => flushPageTime(false), PAGE_FLUSH_SECONDS * 1000);
  startIdleWatch();
}

function stopPageTracking() {
  clearInterval(pageTickTimer);
  clearInterval(pageFlushTimer);
  pageTickTimer = null;
  pageFlushTimer = null;
  stopIdleWatch();
}

async function flushPageTime(keepalive) {
  if (!activeSession || !pdfTotalPages || !Object.keys(pageTime).length) return;
  try {
    await apiFetch(`/sessions/${activeSession.id}/pages`, {
      method: "POST",
      keepalive,
      body: JSON.stringify({ totalPages: pdfTotalPages, currentPage: currentPdfPage(), pages: pageTime }),
    });
  } catch (err) {
    console.warn("บันทึกเวลาที่อ่านแต่ละหน้าไม่สำเร็จ:", err);
  }
}

// ================== ไม่ขยับระหว่างอ่าน: ไม่มีการขยับเมาส์/เลื่อนหน้า/กดปุ่ม/แตะจอนาน IDLE_PROMPT_SECONDS ==================
// หยุดนาฬิกาแล้วถามว่ายังอ่านอยู่ไหม — ช่วงตั้งแต่ขยับครั้งสุดท้ายจนกด "อ่านต่อ" ไม่นับเป็นเวลาอ่าน (server หักให้แบบเดียวกับสลับแท็บ)
// ใช้เฉพาะตัวแสดง PDF.js — ตัวแสดงของเบราว์เซอร์ (iframe) ขยับข้างในแล้วหน้านี้ไม่รู้ จะเด้งถามทั้งที่อ่านอยู่

const IDLE_PROMPT_SECONDS = 3 * 60;
const IDLE_ACTIVITY_EVENTS = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart", "scroll"];
let lastActivityAt = Date.now();
let idleCheckTimer = null;
let idlePromptOpen = false;

function markActivity() {
  if (!idlePromptOpen) lastActivityAt = Date.now();
}

function startIdleWatch() {
  stopIdleWatch();
  lastActivityAt = Date.now();
  // capture: เลื่อนในกล่อง PDF ไม่ bubble ขึ้นมาถึง document
  IDLE_ACTIVITY_EVENTS.forEach((type) => document.addEventListener(type, markActivity, { capture: true, passive: true }));
  idleCheckTimer = setInterval(checkIdle, 1000);
}

function stopIdleWatch() {
  clearInterval(idleCheckTimer);
  idleCheckTimer = null;
  IDLE_ACTIVITY_EVENTS.forEach((type) => document.removeEventListener(type, markActivity, { capture: true }));
  if (idlePromptOpen) {
    idlePromptOpen = false;
    document.getElementById("idleModal").style.display = "none";
  }
}

function checkIdle() {
  if (!activeSession || sessionPhase !== "reading" || document.hidden || idlePromptOpen || !pdfTotalPages) return;
  const idleSeconds = Math.floor((Date.now() - lastActivityAt) / 1000);
  if (idleSeconds < IDLE_PROMPT_SECONDS) return;

  idlePromptOpen = true;
  pauseCountdown();
  // นาฬิกาเดินไประหว่างที่ไม่ขยับ — คืนเวลาส่วนนั้นให้ ต้องอ่านจริงให้ครบเวลาที่ตั้งไว้
  remainingSeconds = Math.min(activeSession.plannedReadSeconds, remainingSeconds + idleSeconds);
  updateReaderClockDisplay(remainingSeconds);
  apiFetch(`/sessions/${activeSession.id}/away`, { method: "POST", body: JSON.stringify({ idleSeconds }) }).catch(() => {});
  flushPageTime(false);

  document.getElementById("idleModalText").textContent =
    `ไม่ได้ขยับเมาส์หรือเลื่อนหน้ามา ${formatAwayDuration(IDLE_PROMPT_SECONDS)} นาฬิกาหยุดไว้ก่อนนะ\n` +
    "ช่วงที่ไม่ได้ขยับจะไม่ถูกนับเป็นเวลาอ่าน กด \"อ่านต่อ\" เพื่อนับเวลาต่อ";
  document.getElementById("idleModal").style.display = "flex";
  document.getElementById("idleContinueBtn").focus();
}

function continueAfterIdle() {
  if (!idlePromptOpen) return;
  idlePromptOpen = false;
  document.getElementById("idleModal").style.display = "none";
  lastActivityAt = Date.now();
  if (!activeSession || sessionPhase !== "reading") return;
  apiFetch(`/sessions/${activeSession.id}/back`, { method: "POST" }).catch(() => {});
  resumeCountdown();
}

// readerStartStopBtn ทำหน้าที่ต่างกันตามช่วง: ระหว่างอ่าน = "หยุด" (จบรอบก่อนเวลา คิดคอยน์ตามเวลาที่อ่านจริง), ระหว่างพัก = "ข้ามพัก"
async function stopReading() {
  if (onBreak) {
    finishBreak(false);
    return;
  }
  if (!activeSession || sessionPhase !== "reading") return;

  const confirmStop = confirm(
    `ต้องการหยุดอ่านตอนนี้เลยหรือไม่? คิดคอยน์ตามเวลาที่อ่านจริง (ทุกๆ ${readingRules.minutesPerBlock} นาทีที่อ่านครบ) ` +
      `คอยน์จะเข้าหลังทำแบบทดสอบหลังอ่านบทนี้`
  );
  if (!confirmStop) return;

  stopCountdownSound();
  await completeReadingSession(false); // false = จบก่อนเวลา ไม่เข้าสู่ช่วงพัก
}

// ================== เพลงนับถอยหลังก่อนหมดเวลาอ่าน (sound/reading-countdown.m4a ยาว ~12.7 วิ) ==================
// เริ่มเล่นตอนเหลือ COUNTDOWN_LEAD_SECONDS วิ — จังหวะพีคท้ายเพลง (วินาทีที่ ~10.5 ของไฟล์) ตรงกับตอนนาฬิกาเป็น 00:00
// สลับแท็บแล้วนาฬิกาหยุด เพลงก็หยุดด้วย กลับมาแล้วเล่นต่อจากตำแหน่งที่ตรงกับเวลาที่เหลือ
const COUNTDOWN_SOUND_URL = "sound/reading-countdown.m4a";
const COUNTDOWN_LEAD_SECONDS = 11;
const countdownSound = new Audio(COUNTDOWN_SOUND_URL);
countdownSound.preload = "auto";
registerUnlockableAudio(countdownSound); // Safari/มือถือ: ปลดล็อกตอนผู้ใช้กดปุ่ม ไม่งั้นเล่นเองตอนเหลือ 11 วิไม่ได้ (reading-aids.js)

function playCountdownSound(secondsLeft) {
  try {
    countdownSound.currentTime = Math.max(0, COUNTDOWN_LEAD_SECONDS - secondsLeft);
    countdownSound.play().catch((err) => console.error("เล่นเสียงนับถอยหลังไม่สำเร็จ:", err));
  } catch (err) {
    console.error("เล่นเสียงนับถอยหลังไม่สำเร็จ:", err);
  }
}

function stopCountdownSound() {
  try {
    countdownSound.pause();
    countdownSound.currentTime = 0;
  } catch (_) {}
}

// ================== นับถอยหลังระหว่างอ่าน (แสดงผลในช่องเวลาอ่านโดยตรง) ==================
// แยก start (ตั้งเวลาใหม่) กับ resume (นับต่อจากที่ค้างไว้) เพื่อรองรับการหยุด/เดินต่อตอนสลับแท็บ

function startCountdown(totalSeconds) {
  remainingSeconds = totalSeconds;
  updateReaderClockDisplay(remainingSeconds);
  resumeCountdown();
}

function resumeCountdown() {
  clearInterval(countdownInterval);
  // กลับมาจากแท็บอื่นช่วงที่เพลงนับถอยหลังเล่นอยู่ — เล่นต่อให้ตรงกับเวลาที่เหลือ
  if (remainingSeconds > 0 && remainingSeconds < COUNTDOWN_LEAD_SECONDS) playCountdownSound(remainingSeconds);
  countdownInterval = setInterval(async () => {
    remainingSeconds -= 1;
    updateReaderClockDisplay(Math.max(0, remainingSeconds));
    if (remainingSeconds === COUNTDOWN_LEAD_SECONDS) playCountdownSound(remainingSeconds);

    if (remainingSeconds <= 0) {
      clearInterval(countdownInterval);
      await completeReadingSession(true); // true = อ่านครบเวลาเองตามธรรมชาติ ต่อด้วยช่วงพักถ้ามีตั้งไว้
    }
  }, 1000);
}

function pauseCountdown() {
  clearInterval(countdownInterval);
  countdownSound.pause();
}

// ออกจากหน้าอ่านสั้นกว่านี้ (เช่น สลับแท็บแวบเดียว) ไม่ต้องเด้งเตือน แต่ server ก็ยังหักเวลาให้ตามจริง
const AWAY_NOTICE_MIN_SECONDS = 5;

function formatAwayDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s} วินาที`;
  return s === 0 ? `${m} นาที` : `${m} นาที ${s} วินาที`;
}

function updateReaderClockDisplay(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  document.getElementById("readerMinutes").value = m;
  document.getElementById("readerSeconds").value = s;
}

function updateBreakClockDisplay(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  document.getElementById("readerBreakMinutes").value = m;
  document.getElementById("readerBreakSeconds").value = s;
}

// จบรอบอ่าน (ทั้งอ่านครบเวลาเองและกด "หยุด" ก่อนเวลา) — คิดคอยน์ตามเวลาที่อ่านจริง (ปัดลงทุกๆ 5 นาที)
// คอยน์ยังไม่เข้า: ค้างไว้จนกว่าจะทำแบบทดสอบหลังอ่านของบทนี้ | ได้คอยน์วันละไม่เกิน 4 รอบ
// enterBreakAfter = true เฉพาะตอนอ่านครบเวลาตามธรรมชาติเท่านั้น ถ้าหยุดเองจะปิดหน้าอ่านทันที ไม่เข้าช่วงพัก
async function completeReadingSession(enterBreakAfter) {
  if (!activeSession || sessionPhase !== "reading") return;
  const sessionId = activeSession.id;
  const chapter = chaptersData.find((c) => c.id === activeSession.chapterId);

  clearInterval(countdownInterval);
  sessionPhase = null; // กันนับถอยหลังต่อตอนสลับแท็บกลับมา ระหว่างรอผล
  stopPageTracking();
  await flushPageTime(false); // ส่งเวลาต่อหน้าครั้งสุดท้ายก่อนปิดรอบ

  let result;
  try {
    result = await apiFetch(`/sessions/${sessionId}/complete`, { method: "POST" });
  } catch (err) {
    console.error("Complete session error:", err);
    alert("เกิดข้อผิดพลาดในการบันทึกผลการอ่าน: " + err.message);
    finishRound(enterBreakAfter);
    return;
  }

  updateCoinBadge(result.totalCoins);
  if (result.roundsCap) readingRules.roundsUsed = result.roundsUsed;
  if (chapter && result.progress) chapter.progress = result.progress;
  showRoundSummary(result, chapter, enterBreakAfter);
}

// ปิดรอบการอ่าน (session จบที่ฝั่งเซิร์ฟเวอร์แล้ว ไม่ต้อง cancel ซ้ำได้อีก) แล้วเข้าช่วงพักถ้าอ่านครบเวลาและมีเวลาพัก
function finishRound(enterBreakAfter) {
  const plannedBreakSeconds = (activeSession && activeSession.plannedBreakSeconds) || 0;
  activeSession = null;
  sessionPhase = null;

  if (enterBreakAfter && plannedBreakSeconds > 0) {
    startBreakCountdown(plannedBreakSeconds);
  } else {
    resetReaderTimerState();
  }
}

// ================== ป๊อปอัพกลาง: สรุปรอบอ่าน / แบบทดสอบก่อน-หลังอ่าน / ผลแบบทดสอบ ==================

function setQuizButtons(primary, secondary) {
  const primaryBtn = document.getElementById("quizPrimaryBtn");
  const secondaryBtn = document.getElementById("quizSecondaryBtn");
  for (const [btn, cfg] of [[primaryBtn, primary], [secondaryBtn, secondary]]) {
    btn.style.display = cfg ? "" : "none";
    btn.disabled = false;
    btn.onclick = cfg ? cfg.onClick : null;
    if (cfg) btn.textContent = cfg.label;
  }
}

function openQuizPanel({ kicker, title, hint }) {
  document.getElementById("quizKicker").textContent = kicker;
  document.getElementById("quizTitle").textContent = title;
  const hintEl = document.getElementById("quizHint");
  hintEl.textContent = hint || "";
  hintEl.style.display = hint ? "" : "none";
  document.getElementById("quizError").style.display = "none";
  document.getElementById("quizModal").style.display = "flex";
}

function closeQuizPanel() {
  document.getElementById("quizModal").style.display = "none";
}

// สรุปหลังจบรอบอ่าน: คอยน์รอปลดล็อก + ความคืบหน้าของบท + ปุ่มไปทำแบบทดสอบหลังอ่าน (ถ้าอ่านครบเวลาของบทแล้ว)
function showRoundSummary(result, chapter, enterBreakAfter) {
  const progress = result.progress || {};
  lastRoundChapter = chapter || null;
  lastRoundStreak = result.streak || null;
  const lines = [];
  if (result.chapterRewardLimitReached) {
    lines.push("บทนี้ได้คอยน์ครบ 4 ครั้งแล้ว รอบนี้จึงไม่ได้คอยน์ (แต่นับเวลาอ่านให้นะ) 📖");
  } else if (result.capped && result.coinsEarned === 0) {
    lines.push(`วันนี้ได้คอยน์จากการอ่านครบ ${result.roundsCap} รอบแล้ว รอบนี้จึงไม่ได้คอยน์ (แต่นับเวลาอ่านให้นะ) 📖`);
  } else {
    lines.push(`รอบนี้ได้ ${result.coinsEarned} คอยน์ <img src="img/coin_ja.png" alt="คอยน์" class="coin-inline"> — ${result.coinsPending ? "รอปลดล็อก จะเข้าเมื่อทำแบบทดสอบหลังอ่านบทนี้ผ่าน" : "เข้าบัญชีแล้ว"}`);
    if (result.capped) lines.push(`(ครบโควต้าวันละ ${result.roundsCap} รอบพอดี คอยน์รอบนี้เลยได้ไม่เต็ม)`);
  }
  if (result.roundsCap) lines.push(`วันนี้ได้คอยน์จากการอ่านแล้ว ${result.roundsUsed}/${result.roundsCap} รอบ`);
  const pages = result.pages;
  if (pages && pages.totalPages && pages.pagesViewed > 0) {
    const range = pages.firstPage === pages.lastPage ? `หน้า ${pages.firstPage}` : `หน้า ${pages.firstPage}–${pages.lastPage}`;
    lines.push(`📄 รอบนี้เปิดอ่าน ${pages.pagesViewed} หน้า (${range} จาก ${pages.totalPages} หน้า)`);
  }
  if (result.petHappinessGained > 0) lines.push(`🐶 น้องหมาดีใจที่ได้อ่านด้วยกัน ความสุข +${result.petHappinessGained}%`);
  if (result.streak && result.streak.readToday) lines.push(`🔥 อ่านติดกัน ${result.streak.current} วันแล้ว!`);
  if (result.awaySeconds >= AWAY_NOTICE_MIN_SECONDS) {
    lines.push(`ไม่นับเวลาที่ออกจากหน้าอ่าน ${formatAwayDuration(result.awaySeconds)}`);
  }
  if (progress.status === "reading") {
    lines.push(
      `บทนี้อ่านแล้ว ${formatMinutes(progress.readSeconds)} / ${formatMinutes(progress.minReadSeconds)} · ` +
        `คอยน์รอปลดล็อกรวม ${progress.pendingCoins} <img src="img/coin_ja.png" alt="คอยน์" class="coin-inline">`
    );
  }

  openQuizPanel({
    kicker: "จบรอบอ่าน",
    title: result.completedFullDuration ? "อ่านครบเวลาแล้ว! 🎉" : "หยุดอ่านแล้ว",
    hint: progress.canPostTest ? "อ่านบทนี้ครบเวลาแล้ว ทำแบบทดสอบหลังอ่านเพื่อรับคอยน์ทั้งหมด + โบนัสข้อที่ตอบถูก" : "",
  });
  // เหมือนบรรทัดสถานะของบท: ข้อความชุดนี้เราเขียนเองทั้งหมด จึงมีรูปคอยน์เป็น HTML ได้
  document.getElementById("quizBody").innerHTML = `<div class="round-summary">${lines
    .map((l) => `<p>${l}</p>`)
    .join("")}</div>`;

  const done = () => {
    closeQuizPanel();
    finishRound(enterBreakAfter);
  };
  if (progress.canPostTest && chapter) {
    setQuizButtons(
      {
        label: "📝 ทำแบบทดสอบหลังอ่านเลย",
        onClick: () => {
          activeSession = null;
          runChapterTest(chapter, "post", () => resetReaderTimerState());
        },
      },
      { label: enterBreakAfter && activeSession && activeSession.plannedBreakSeconds ? "พักก่อน" : "ไว้ทีหลัง", onClick: done }
    );
  } else {
    setQuizButtons({ label: "ตกลง", onClick: done }, null);
  }
}

// ---------- แบบทดสอบ (ถามทีละข้อ server จับเวลาข้อละ 1 นาที) ----------
// ก่อนอ่าน: ต้องทำให้จบ (หมดเวลานับว่ายังไม่รู้) จบแล้วบอกคะแนน + ข้อไหนถูก/ผิด | หลังอ่าน: สลับแท็บระหว่างข้อ = ข้อนั้นผิด
// ทั้งสองแบบไม่เฉลยคำตอบ | หลังอ่านต้องได้ 8/10 ขึ้นไปถึงผ่าน ไม่ผ่านทำใหม่ได้จนกว่าจะผ่าน

const OPTION_LABELS = ["ก", "ข", "ค", "ง"];
const TEST_COPY = {
  pre: {
    kicker: "แบบทดสอบก่อนอ่าน",
    hint: "ตอบตามที่รู้ตอนนี้ ไม่มีผลกับคอยน์ · ข้อละ 1 นาที (หมดเวลานับว่ายังไม่รู้)",
    leave: null,
  },
  post: {
    kicker: "แบบทดสอบหลังอ่าน",
    hint: "ข้อละ 1 นาที · ห้ามสลับแท็บ (สลับแท็บ = ข้อนั้นผิด) · ได้ 8/10 ขึ้นไปถึงจะผ่าน และได้คอยน์ + โบนัสข้อละ 10 คอยน์",
    leave: "ออกก่อน",
  },
};

let quiz = null; // { chapter, phase, onFinished, question, timerId, deadline, tabSwitched, busy }

async function runChapterTest(chapter, phase, onFinished) {
  quiz = { chapter, phase, onFinished, question: null, timerId: null, deadline: 0, tabSwitched: false, busy: true };
  const copy = TEST_COPY[phase];
  openQuizPanel({ kicker: copy.kicker, title: `Chapter ${chapter.chapter_number} ${chapter.title}`, hint: copy.hint });
  document.getElementById("quizBody").innerHTML = `<p class="quiz-loading">กำลังโหลดคำถาม...</p>`;
  setQuizButtons(null, copy.leave ? { label: copy.leave, onClick: leaveTest } : null);

  try {
    const res = await apiFetch(`/chapters/${chapter.id}/test/next`, { method: "POST", body: JSON.stringify({ phase }) });
    handleTestResponse(res);
  } catch (err) {
    showTestError(err.message, true);
  }
}

function handleTestResponse(res) {
  if (!quiz) return;
  quiz.busy = false;
  if (res.done) {
    finishTest(res.summary);
  } else {
    renderTestQuestion(res.question);
  }
}

function showTestError(message, fatal) {
  const errorEl = document.getElementById("quizError");
  errorEl.textContent = message;
  errorEl.style.display = "block";
  if (fatal) {
    if (quiz) clearInterval(quiz.timerId);
    document.getElementById("quizBody").innerHTML = "";
    setQuizButtons({ label: "ปิด", onClick: () => endTest(false) }, null);
  }
}

function renderTestQuestion(q) {
  quiz.question = q;
  quiz.tabSwitched = false;
  document.getElementById("quizTitle").textContent = `ข้อ ${q.index} / ${q.total}`;
  document.getElementById("quizError").style.display = "none";

  const optionsHtml = q.options
    .map(
      (opt, i) => `
        <button type="button" class="quiz-option" data-picked="${i + 1}">
          <span class="quiz-option-label">${OPTION_LABELS[i]}</span>
          <span>${escapeHtml(opt)}</span>
        </button>`
    )
    .join("");

  const body = document.getElementById("quizBody");
  body.innerHTML = `
    <div class="quiz-timer" aria-live="polite">
      <div class="quiz-timer-bar"><div class="quiz-timer-fill" id="quizTimerFill"></div></div>
      <span class="quiz-timer-text" id="quizTimerText"></span>
    </div>
    <p class="quiz-question">${escapeHtml(q.question)}</p>
    <div class="quiz-options">${optionsHtml}</div>
  `;
  body.querySelectorAll(".quiz-option").forEach((btn) => {
    btn.addEventListener("click", () => submitTestAnswer(Number(btn.dataset.picked)));
  });

  // นับถอยหลังตามเวลาที่ server บอก (server ตรวจเวลาเองอีกชั้น ตอบช้าเกินก็นับผิด)
  clearInterval(quiz.timerId);
  quiz.deadline = Date.now() + q.secondsLeft * 1000;
  const tick = () => {
    const left = Math.max(0, Math.ceil((quiz.deadline - Date.now()) / 1000));
    document.getElementById("quizTimerText").textContent = `${left} วินาที`;
    const fill = document.getElementById("quizTimerFill");
    fill.style.width = `${(left / 60) * 100}%`;
    fill.classList.toggle("urgent", left <= 10);
    if (left <= 0) submitTestAnswer(0); // หมดเวลา: ก่อนอ่านนับเป็น "ยังไม่รู้" / หลังอ่านนับผิด
  };
  tick();
  quiz.timerId = setInterval(tick, 250);
}

async function submitTestAnswer(picked) {
  if (!quiz || quiz.busy || !quiz.question) return;
  quiz.busy = true;
  clearInterval(quiz.timerId);
  document.querySelectorAll("#quizBody button").forEach((b) => (b.disabled = true));

  const current = quiz;
  try {
    const res = await apiFetch(`/chapters/${current.chapter.id}/test/answer`, {
      method: "POST",
      body: JSON.stringify({ phase: current.phase, picked, tabSwitched: current.tabSwitched }),
    });
    if (quiz !== current) return;
    handleTestResponse(res);
  } catch (err) {
    if (quiz !== current) return;
    quiz.busy = false;
    showTestError(`ส่งคำตอบไม่สำเร็จ: ${err.message}`, true);
  }
}

// สลับแท็บระหว่างทำแบบทดสอบหลังอ่าน: ข้อนั้นนับว่าผิด (ส่งทันทีที่กลับมาที่แท็บนี้)
function onTestVisibilityChange() {
  if (!quiz || quiz.phase !== "post" || !quiz.question || quiz.busy) return;
  if (document.hidden) {
    quiz.tabSwitched = true;
  } else if (quiz.tabSwitched) {
    alert("คุณสลับแท็บระหว่างทำแบบทดสอบหลังอ่าน ข้อนี้นับว่าผิดนะ");
    submitTestAnswer(0);
  }
}

function leaveTest() {
  if (!quiz) return;
  const warning = quiz.phase === "post"
    ? "ออกจากแบบทดสอบหลังอ่านตอนนี้? ข้อที่เปิดอยู่จะนับว่าผิดถ้าหมดเวลาก่อนกลับมา และคอยน์ของบทนี้จะเข้าหลังทำครบเท่านั้น"
    : "ทำแบบทดสอบก่อนอ่านทีหลัง? ต้องทำให้เสร็จก่อนถึงจะเริ่มอ่านบทนี้ได้";
  if (!confirm(warning)) return;
  endTest(false);
}

async function endTest(completed) {
  if (!quiz) return;
  const { onFinished } = quiz;
  clearInterval(quiz.timerId);
  quiz = null;
  closeQuizPanel();
  // โหลดสถานะบท/คอยน์ใหม่ (การ์ดบท + ป้ายสถานะ)
  try {
    await Promise.all([loadChapters(), loadUserInfo()]);
  } catch (err) {
    console.error("Reload chapters error:", err);
  }
  if (completed) onFinished();
  else if (!activeSession && !onBreak) resetReaderTimerState();
}

// รายการข้อ: บอกแค่ถูก/ผิด ไม่เฉลยคำตอบ (pre กับ post เป็นข้อชุดเดียวกัน)
function testResultRows(results) {
  return results
    .map((q, i) => {
      let detail;
      if (q.correct) detail = "✅ ถูก";
      else if (q.tabSwitched) detail = "❌ ผิด (สลับแท็บระหว่างทำข้อนี้)";
      else if (q.timedOut) detail = "❌ ผิด (หมดเวลา)";
      else detail = "❌ ผิด";
      return `
        <li class="quiz-result-item">
          <p class="quiz-result-question">${i + 1}. ${escapeHtml(q.question)}</p>
          <p class="quiz-result-line ${q.correct ? "is-correct" : "is-wrong"}">${detail}</p>
        </li>`;
    })
    .join("");
}

function finishTest(summary) {
  clearInterval(quiz.timerId);
  quiz.question = null;
  if (summary.phase === "pre") {
    document.getElementById("quizTitle").textContent = `ก่อนอ่านได้ ${summary.preScore}/${summary.total} คะแนน`;
    document.getElementById("quizHint").style.display = "none";
    document.getElementById("quizBody").innerHTML = `
      ${summary.results ? `<ol class="quiz-results">${testResultRows(summary.results)}</ol>` : ""}
      <p class="round-summary">เริ่มอ่านได้เลย! อ่านครบเวลาของบทนี้แล้วจะได้ทำแบบทดสอบหลังอ่าน (ข้อเดิม สลับลำดับ) ต้องได้ ${Math.ceil(summary.total * 0.8)}/${summary.total} ขึ้นไปถึงจะผ่าน 📖</p>`;
    setQuizButtons({ label: "เริ่มอ่าน", onClick: () => endTest(true) }, null);
    return;
  }
  showTestResults(summary);
}

// ผลแบบทดสอบหลังอ่าน: คะแนน + ผ่านไหม + ข้อไหนถูก/ผิด (ไม่เฉลย)
// ผ่าน = ได้คอยน์ (ถ้าบทนี้ยังได้ไม่ครบ 4 ครั้ง) | ไม่ผ่าน = บอกว่าต้องได้เท่าไหร่ + ปุ่มลองอีกครั้ง / กลับไปอ่าน
function showTestResults(summary) {
  const scoreText = summary.preScore != null
    ? `ก่อนอ่าน ${summary.preScore}/${summary.total} → หลังอ่าน ${summary.postScore}/${summary.total}`
    : `หลังอ่าน ${summary.postScore}/${summary.total}`;
  document.getElementById("quizKicker").textContent = "ผลแบบทดสอบหลังอ่าน";
  document.getElementById("quizTitle").textContent = scoreText;
  document.getElementById("quizHint").style.display = "none";

  const rows = testResultRows(summary.results);
  const body = document.getElementById("quizBody");

  if (!summary.passed) {
    const missing = Math.max(0, summary.passScore - summary.postScore);
    body.innerHTML = `
      <div class="quiz-verdict is-fail">
        <p class="quiz-verdict-title">ยังไม่ผ่าน · ได้ ${summary.postScore}/${summary.total} คะแนน</p>
        <p>ต้องได้ ${summary.passScore}/${summary.total} คะแนนขึ้นไปถึงจะผ่าน (ขาดอีก ${missing} คะแนน)</p>
        <p class="quiz-coins-sub">ยังไม่ได้คอยน์ · คอยน์จากเวลาอ่าน ${summary.pendingCoins || 0} <img src="img/coin_ja.png" alt="คอยน์" class="coin-inline"> เก็บไว้ให้ จะได้เมื่อทำผ่าน · ทำได้จนกว่าจะผ่าน</p>
      </div>
      <ol class="quiz-results">${rows}</ol>
      <p class="quiz-hint">ไม่เฉลยข้อที่ผิดนะ ลองอีกครั้ง (ข้อเดิม สลับลำดับ) หรือกลับไปอ่านบทเรียนก่อนก็ได้</p>
    `;
    setQuizButtons(
      { label: "🔁 ลองอีกครั้ง", onClick: retryPostTest },
      { label: "📖 กลับไปอ่านบทเรียนอีกรอบ", onClick: rereadAfterFail }
    );
    return;
  }

  const coins = summary.coinsTime + summary.coinsBonus;
  const coinsHtml = summary.rewardLimitReached
    ? `<p>บทนี้ได้คอยน์ครบ ${summary.coinRewardsMax} ครั้งแล้ว ครั้งนี้จึงไม่ได้คอยน์</p>`
    : `<p>คอยน์จากเวลาอ่าน ${summary.coinsTime} + โบนัสตอบถูก ${summary.coinsBonus} = <strong>${coins} คอยน์</strong> 🎉</p>
       <p class="quiz-coins-sub">เหรียญรวม ${summary.totalCoins} · โบนัสข้อละ ${summary.bonusPerCorrect} คอยน์ (ข้อที่เคยตอบถูกแล้วไม่ได้ซ้ำ) · ได้คอยน์จากบทนี้แล้ว ${summary.coinRewardsUsed}/${summary.coinRewardsMax} ครั้ง</p>`;
  body.innerHTML = `
    <div class="quiz-verdict is-pass">
      <p class="quiz-verdict-title">✅ ผ่านแล้ว! ได้ ${summary.postScore}/${summary.total} คะแนน</p>
      <p class="quiz-coins-sub">เกณฑ์ผ่าน ${summary.passScore}/${summary.total} · นับเป็นเงื่อนไขแลกคูปอง</p>
    </div>
    <div class="quiz-coins">${coinsHtml}</div>
    <ol class="quiz-results">${rows}</ol>
    <p class="quiz-unlock">🎮 โลกที่ ${quiz.chapter.chapter_number} ในเกมเปิดแล้ว ไปทบทวนกันเลย!</p>
  `;
  updateCoinBadge(summary.totalCoins);
  setQuizButtons({ label: "ตกลง", onClick: () => endTest(true) }, null);
}

// ไม่ผ่าน → ทำ post ใหม่ทันที (server ใช้ข้อเดิม สลับลำดับ)
function retryPostTest() {
  if (!quiz) return;
  const { chapter, onFinished } = quiz;
  clearInterval(quiz.timerId);
  quiz = null;
  runChapterTest(chapter, "post", onFinished);
}

// ไม่ผ่าน → กลับไปเลือกรอบอ่านบทเดิม (อ่านแล้วกลับมาทำ post ได้ทุกเมื่อ ไม่ต้องอ่านครบเวลาใหม่)
async function rereadAfterFail() {
  if (!quiz) return;
  const chapterId = quiz.chapter.id;
  await endTest(false);
  const chapter = chaptersData.find((c) => c.id === chapterId);
  if (chapter) openChapterTimeModal(chapter);
}

// ================== ช่วงพักหลังอ่านจบ (นับถอยหลังฝั่ง client ล้วนๆ ไม่มี session ผูกอยู่แล้ว) ==================

function startBreakCountdown(totalSeconds) {
  onBreak = true;

  const btn = document.getElementById("readerStartStopBtn");
  btn.textContent = "ข้ามพัก";
  btn.classList.remove("is-running");
  btn.classList.add("on-break");

  // ช่วงพักนับตามนาฬิกาจริง สลับแท็บก็นับต่อ (ช่วงพักไม่เกี่ยวกับคอยน์) แล้วแจ้งเตือนตอนพักครบ
  breakEndsAt = Date.now() + totalSeconds * 1000;
  askNotificationPermission(); // เรียกจากการกดปุ่มของผู้ใช้ (เบราว์เซอร์ให้ขอสิทธิ์ได้เฉพาะตอนนี้)
  startBreakMusic();
  keepScreenOn();
  tickBreak();
  clearInterval(breakCountdownInterval);
  breakCountdownInterval = setInterval(tickBreak, 1000);
}

function tickBreak() {
  if (!onBreak) return;
  const left = Math.max(0, Math.ceil((breakEndsAt - Date.now()) / 1000));
  updateBreakClockDisplay(left);
  fadeBreakMusic(left);
  if (left <= 0) finishBreak(true);
}

// พักครบ (completedNaturally) หรือกด "ข้ามพัก" → ปิดเพลง แล้วถามว่าจะอ่านรอบต่อไปไหม
function finishBreak(completedNaturally) {
  clearInterval(breakCountdownInterval);
  onBreak = false;
  stopBreakMusic();

  if (completedNaturally) {
    playBreakEndChime();
    if (document.hidden) {
      notifyBreakOver(); // กดที่แจ้งเตือนแล้วกลับมาหน้านี้
      startTitleBlink("⏰ พักครบแล้ว!");
    }
  }
  showBreakOverPanel(completedNaturally);
}

// ป๊อปอัพหลังพัก: สรุปวันนี้ + ปุ่มอ่านรอบต่อไป (บทเดิม รอบเวลาเดิม) / พอแค่นี้
function showBreakOverPanel(completedNaturally) {
  const chapter = lastRoundChapter && chaptersData.find((c) => c.id === lastRoundChapter.id);
  const progress = chapter && chapter.progress;
  const lines = [];
  if (readingRules.roundsCap) {
    lines.push(`วันนี้ได้คอยน์จากการอ่านแล้ว ${readingRules.roundsUsed}/${readingRules.roundsCap} รอบ`);
  }
  if (lastRoundStreak && lastRoundStreak.readToday) lines.push(`🔥 อ่านติดกัน ${lastRoundStreak.current} วัน`);
  if (progress && progress.status === "reading") {
    lines.push(`บทนี้อ่านแล้ว ${formatMinutes(progress.readSeconds)} / ${formatMinutes(progress.minReadSeconds)}`);
    if (progress.canPostTest) lines.push("📝 อ่านครบเวลาของบทนี้แล้ว ทำแบบทดสอบหลังอ่านได้ที่หน้าเลือกบท");
  }

  openQuizPanel({
    kicker: completedNaturally ? "พักครบแล้ว" : "ข้ามพัก",
    title: "พร้อมอ่านรอบต่อไปไหม? 📖",
    hint: "",
  });
  document.getElementById("quizBody").innerHTML = `<div class="round-summary">${lines
    .map((l) => `<p>${escapeHtml(l)}</p>`)
    .join("")}</div>`;

  const done = () => {
    closeQuizPanel();
    resetReaderTimerState();
  };
  const canContinue = chapter && progress && progress.status !== "post_test" && progress.status !== "pre_test";
  setQuizButtons(
    canContinue
      ? {
          label: "📖 อ่านรอบต่อไป",
          onClick: async () => {
            closeQuizPanel();
            try {
              await startReadingRound(chapter);
            } catch (err) {
              alert(err.message);
              resetReaderTimerState();
            }
          },
        }
      : { label: "ตกลง", onClick: done },
    canContinue ? { label: "พอแค่นี้", onClick: done } : null
  );
}

// เคลียร์ session + ปิดหน้าจออ่าน PDF กลับไปหน้า Dashboard ปกติ (เรียกตอนอ่านจบไม่มีพัก, ตอนพักครบ/ข้ามพัก, และตอนหยุดก่อนเวลา)
function resetReaderTimerState() {
  clearInterval(countdownInterval);
  clearInterval(breakCountdownInterval);
  // ปิดเพลงนับถอยหลังถ้ายังเล่นค้างอยู่ (เช่น user กดยกเลิกช่วงวินาทีสุดท้าย)
  stopCountdownSound();
  activeSession = null;
  sessionPhase = null;
  remainingSeconds = 0;
  onBreak = false;
  stopBreakMusic();
  allowScreenOff();
  stopTitleBlink();
  stopPageTracking();

  closeReaderView();
  document.getElementById("readerPdfFrame").src = "";
  if (pdfReaderAvailable()) closePdfReader();
  pdfTotalPages = 0;
  // อัปเดตป้ายสถานะบนการ์ดบท (เวลาที่อ่านสะสม / พร้อมทำแบบทดสอบ)
  loadChapters().catch((err) => console.error("Reload chapters error:", err));
  window.currentReadingChapterTitle = null;
  window.currentReadingChapterId = null;
  selectedChapter = null;
}

// ================== Logout ==================

function logout() {
  localStorage.removeItem("token");
  localStorage.removeItem("currentUser");
  window.location.href = "login.html";
}

// ================== ผูก event listener ที่เป็น element คงที่ในหน้า ==================

function bindStaticEventListeners() {
  document.getElementById("openModalBtn").addEventListener("click", openGoalModal);
  document.getElementById("confirmBtn").addEventListener("click", submitGoal);
  document.getElementById("goalModal").addEventListener("click", (e) => {
    if (e.target.id === "goalModal") closeGoalModal(); // กดพื้นหลังเพื่อปิด
  });

  document.getElementById("startReadingBtn").addEventListener("click", confirmStartReading);
  document.getElementById("cancelReadingBtn").addEventListener("click", closeChapterModal);
  document.getElementById("chapterModal").addEventListener("click", (e) => {
    if (e.target.id === "chapterModal") closeChapterModal(); // กดพื้นหลังเพื่อปิด
  });

  document.getElementById("postTestBtn").addEventListener("click", startPostTestFromModal);
  document.getElementById("readerStartStopBtn").addEventListener("click", stopReading);
  document.getElementById("breakMusicBtn").addEventListener("click", toggleBreakMusic);
  document.getElementById("idleContinueBtn").addEventListener("click", continueAfterIdle);
  registerReadingServiceWorker();
  document.addEventListener("visibilitychange", onTestVisibilityChange);

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

  // เตือนก่อนออกจากหน้าถ้ากำลังจับเวลาอ่าน/พักอยู่ กันลืมกด "หยุด"/"ข้ามพัก"
  window.addEventListener("beforeunload", (e) => {
    if (activeSession || onBreak || quiz) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  // สลับแท็บ/ย่อหน้าต่างระหว่างอ่าน: หยุดนับถอยหลังไว้ก่อน แล้วนับต่อจากเดิมตอนกลับมาที่แท็บนี้ (ช่วงพักนับต่อ)
  // ระหว่างอ่าน แจ้ง server ด้วย เพื่อไม่ให้ช่วงที่ออกไปถูกนับเป็นเวลาอ่านตอนคิดเหรียญ
  let awayStartedAt = null;
  document.addEventListener("visibilitychange", () => {
    // นับเฉพาะช่วงกำลังอ่าน — ตอนทำแบบทดสอบก่อน/หลังอ่านไม่มีนาฬิกาเดินอยู่
    // ระหว่างเด้งถาม "ยังอ่านอยู่ไหม" นาฬิกาหยุดและ server นับเป็นช่วงไม่อ่านอยู่แล้ว รอผู้ใช้กด "อ่านต่อ" อย่างเดียว
    const reading = activeSession && sessionPhase === "reading" && !idlePromptOpen;
    if (document.hidden) {
      if (reading) {
        pauseCountdown();
        awayStartedAt = Date.now();
        // keepalive ให้ request ส่งออกไปได้แม้เบราว์เซอร์กำลังพักแท็บ/ปิดหน้า
        apiFetch(`/sessions/${activeSession.id}/away`, { method: "POST", keepalive: true }).catch(() => {});
        flushPageTime(true);
      }
    } else {
      if (reading) {
        const awaySeconds = awayStartedAt ? Math.round((Date.now() - awayStartedAt) / 1000) : 0;
        awayStartedAt = null;
        apiFetch(`/sessions/${activeSession.id}/back`, { method: "POST" }).catch(() => {});
        if (awaySeconds >= AWAY_NOTICE_MIN_SECONDS) {
          alert(`คุณออกจากหน้าอ่านไป ${formatAwayDuration(awaySeconds)}\nช่วงเวลานี้จะไม่ถูกนับเป็นเวลาอ่านนะ 📖`);
        }
        lastActivityAt = Date.now(); // กลับมาที่แท็บ = ขยับแล้ว เริ่มนับไม่ขยับใหม่
        resumeCountdown();
      }
      if (onBreak) tickBreak(); // พักนับต่อตอนอยู่แท็บอื่น — กลับมาแล้วอัปเดตนาฬิกาทันที
    }
  });
}