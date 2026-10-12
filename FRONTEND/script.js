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
let selectedPresetId = null; // รอบ Pomodoro ที่เลือก ("25" = อ่าน 25 พัก 5, "50" = อ่าน 50 พัก 10)
let activeSession = null; // { id, chapterId, plannedReadSeconds, plannedBreakSeconds }
let countdownInterval = null;
let remainingSeconds = 0;
let onBreak = false; // true ระหว่างช่วงพักหลังอ่านจบ (session จบไปแล้ว รอนับเวลาพักอย่างเดียว)
let breakCountdownInterval = null;
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
}

// ป้ายสถานะบนการ์ดบท
function chapterBadge(progress) {
  if (!progress) return "";
  if (progress.status === "post_test" || (progress.status === "reading" && progress.canPostTest)) return "📝 พร้อมทำแบบทดสอบ";
  if (progress.status === "reading" || progress.status === "pre_test") return "📖 กำลังอ่าน";
  if (progress.passed) return "✅ ผ่านแล้ว";
  if (progress.completedCount > 0) return "🔁 อ่านซ้ำได้";
  return "";
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
      
    card.innerHTML = `
      <div class="card-inner">
        ${chapterBadge(chapter.progress) ? `<div class="chapter-badge">${chapterBadge(chapter.progress)}</div>` : ""}
        <div class="chapter-label">CHAPTER ${chapter.chapter_number}</div>
        <p class="chapter-desc">${escapeHtml(chapter.title)}</p>
        <div class="card-icon">${iconHtml}</div>
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

function chapterStatusLines(progress) {
  if (!progress || progress.status === "none" || progress.status === "pre_test") {
    return ["📝 อ่านบทนี้ครั้งแรก: ทำแบบทดสอบก่อนอ่าน 5 ข้อ (ข้อละ 1 นาที) ก่อนนะ ไม่มีผลกับคอยน์"];
  }
  if (progress.status === "post_test") {
    return ["📝 ทำแบบทดสอบหลังอ่านค้างอยู่ ทำให้เสร็จก่อนอ่านต่อนะ (ข้อที่เปิดค้างไว้จนหมดเวลานับว่าผิด)"];
  }
  if (progress.status === "reading") {
    return [
      `📖 อ่านบทนี้แล้ว ${formatMinutes(progress.readSeconds)} / ${formatMinutes(progress.minReadSeconds)} · ` +
        `คอยน์รอปลดล็อก ${progress.pendingCoins} 🪙`,
      progress.canPostTest
        ? "✅ อ่านครบแล้ว! ทำแบบทดสอบหลังอ่านเพื่อรับคอยน์ + โบนัสข้อที่ตอบถูก"
        : "คอยน์จะเข้าหลังทำแบบทดสอบหลังอ่าน (อ่านครบเวลาก่อนถึงจะทำได้)",
    ];
  }
  // completed = อ่านซ้ำ (ชุดใหม่ ไม่มีแบบทดสอบก่อนอ่าน)
  const best = progress.bestPostScore != null ? ` (หลังอ่านดีที่สุด ${progress.bestPostScore}/${progress.total})` : "";
  return [`${progress.passed ? "✅ ผ่านบทนี้แล้ว" : "อ่านบทนี้จบไปแล้ว"}${best} — อ่านซ้ำได้ ข้อที่เคยตอบผิดจะถูกถามก่อนในแบบทดสอบหลังอ่าน`];
}

function renderPresetButtons() {
  const group = document.getElementById("presetGroup");
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

  document.getElementById("chapterStatus").innerHTML = chapterStatusLines(progress)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
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
      : `วันนี้ได้คอยน์จากการอ่านแล้ว ${readingRules.roundsUsed}/${readingRules.roundsCap} รอบ (รอบ 50 นาทีนับเป็น 2 รอบ)`;
    roundsNote.style.display = "";
  } else {
    roundsNote.style.display = "none";
  }

  const busyWithPost = progress && progress.status === "post_test";
  document.getElementById("startReadingBtn").disabled = busyWithPost;
  document.getElementById("presetGroup").style.display = busyWithPost ? "none" : "";
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
  openReaderView(chapter);
  updateBreakClockDisplay(activeSession.plannedBreakSeconds); // โชว์เวลาพักของรอบนี้ไว้ล่วงหน้า (นับถอยหลังหลังอ่านจบ)
  startCountdown(activeSession.plannedReadSeconds);
}

// ปุ่ม "ทำแบบทดสอบหลังอ่าน" ในป๊อปอัพบท (อ่านครบเวลาขั้นต่ำของบทแล้ว)
function startPostTestFromModal() {
  if (!selectedChapter) return;
  const chapter = selectedChapter;
  document.getElementById("chapterModal").style.display = "none";
  runChapterTest(chapter, "post", () => {});
}

// ---- ขั้น 2: หน้าจออ่าน PDF พร้อมนาฬิกานับถอยหลัง (แทนที่การ์ด chapter ในหน้าเดิม เปิดหลังกด "เริ่มจับเวลา" แล้วเท่านั้น) ----

function openReaderView(chapter) {
  window.currentReadingChapterTitle = `CHAPTER ${chapter.chapter_number}: ${chapter.title}`;
  window.currentReadingChapterId = chapter.id;

  loadReaderPdf(chapter);
  document.getElementById("readerError").style.display = "none";

  onBreak = false;
  const btn = document.getElementById("readerStartStopBtn");
  btn.textContent = "หยุด";
  btn.classList.remove("on-break");
  btn.classList.add("is-running");

  document.querySelector(".main-title").style.display = "none";
  document.getElementById("chapterScrollWrapper").style.display = "none";
  document.getElementById("readerView").style.display = "flex";
}

function closeReaderView() {
  document.getElementById("readerView").style.display = "none";
  document.querySelector(".main-title").style.display = "";
  document.getElementById("chapterScrollWrapper").style.display = "";
}

// เช็คก่อนว่ามีไฟล์ PDF ของบทนี้จริงไหม ถ้ายังไม่มี (บทที่ยังไม่ได้อัปโหลด) จะโชว์ข้อความแจ้งเตือนแทนหน้าจอ error ของเบราว์เซอร์
// หมายเหตุ: เช็คด้วย fetch() ได้เฉพาะตอนเปิดผ่าน http/https เท่านั้น เพราะเบราว์เซอร์ (เช่น Chrome) บล็อก fetch() ไปยัง file://
async function loadReaderPdf(chapter) {
  const frame = document.getElementById("readerPdfFrame");
  const placeholder = document.getElementById("readerPdfPlaceholder");
  // ถ้าแอดมินอัปโหลด PDF ไว้ใน backend ให้ใช้อันนั้นก่อน ไม่งั้น fallback ไปหาไฟล์ตามชื่อ chapter เดิม
  const pdfPath = chapter.pdf_url
    ? `${API_BASE_URL.replace(/\/api\/?$/, "")}${chapter.pdf_url}`
    : `pdf/chapter-${chapter.chapter_number}.pdf`;

  let available = true;
  if (location.protocol !== "file:") {
    try {
      const res = await fetch(pdfPath, { method: "HEAD" });
      available = res.ok;
    } catch {
      available = false;
    }
  }

  frame.src = available ? pdfPath : "";
  frame.style.display = available ? "block" : "none";
  placeholder.style.display = available ? "none" : "flex";
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

  await completeReadingSession(false); // false = จบก่อนเวลา ไม่เข้าสู่ช่วงพัก
}

// ================== เสียงแจ้งเตือนก่อนหมดเวลา 5 วินาที (ไฟล์ buzzer 5 วิ จาก sound/timer-end.mp3) ==================

// ใช้ <Audio> element หลายอันเล่นซ้อนกัน = ดังขึ้นทวีคูณ (Web Audio GainNode boost
// เคยลอง แต่ createMediaElementSource ตัด default output แล้วบาง browser เสียงหายเลย
// เลยกลับมาใช้วิธีนี้ที่รองรับทุก browser 100%)
const SOUND_URL = "sound/timer-end.mp3";
const SOUND_COPIES = 3; // จำนวน audio element ที่เล่นพร้อมกัน (ยิ่งเยอะ = ดังยิ่งขึ้น)
const timerEndSounds = Array.from({ length: SOUND_COPIES }, () => {
  const a = new Audio(SOUND_URL);
  a.preload = "auto";
  a.volume = 1.0;
  return a;
});

function playSoftBeep() {
  timerEndSounds.forEach((audio) => {
    try {
      audio.pause();
      audio.currentTime = 0;
      audio.play().catch((err) => console.error("เล่นเสียงแจ้งเตือนไม่สำเร็จ:", err));
    } catch (err) {
      console.error("เล่นเสียงแจ้งเตือนไม่สำเร็จ:", err);
    }
  });
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
  countdownInterval = setInterval(async () => {
    remainingSeconds -= 1;
    updateReaderClockDisplay(Math.max(0, remainingSeconds));
    if (remainingSeconds === 5) playSoftBeep();

    if (remainingSeconds <= 0) {
      clearInterval(countdownInterval);
      await completeReadingSession(true); // true = อ่านครบเวลาเองตามธรรมชาติ ต่อด้วยช่วงพักถ้ามีตั้งไว้
    }
  }, 1000);
}

function pauseCountdown() {
  clearInterval(countdownInterval);
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
  const lines = [];
  if (result.capped && result.coinsEarned === 0) {
    lines.push(`วันนี้ได้คอยน์จากการอ่านครบ ${result.roundsCap} รอบแล้ว รอบนี้จึงไม่ได้คอยน์ (แต่นับเวลาอ่านให้นะ) 📖`);
  } else {
    lines.push(`รอบนี้ได้ ${result.coinsEarned} คอยน์ 🪙 — ${result.coinsPending ? "รอปลดล็อก จะเข้าหลังทำแบบทดสอบหลังอ่านบทนี้" : "เข้าบัญชีแล้ว"}`);
    if (result.capped) lines.push(`(ครบโควต้าวันละ ${result.roundsCap} รอบพอดี คอยน์รอบนี้เลยได้ไม่เต็ม)`);
  }
  if (result.roundsCap) lines.push(`วันนี้ได้คอยน์จากการอ่านแล้ว ${result.roundsUsed}/${result.roundsCap} รอบ`);
  if (result.awaySeconds >= AWAY_NOTICE_MIN_SECONDS) {
    lines.push(`ไม่นับเวลาที่ออกจากหน้าอ่าน ${formatAwayDuration(result.awaySeconds)}`);
  }
  if (progress.status === "reading") {
    lines.push(
      `บทนี้อ่านแล้ว ${formatMinutes(progress.readSeconds)} / ${formatMinutes(progress.minReadSeconds)} · ` +
        `คอยน์รอปลดล็อกรวม ${progress.pendingCoins} 🪙`
    );
  }

  openQuizPanel({
    kicker: "จบรอบอ่าน",
    title: result.completedFullDuration ? "อ่านครบเวลาแล้ว! 🎉" : "หยุดอ่านแล้ว",
    hint: progress.canPostTest ? "อ่านบทนี้ครบเวลาแล้ว ทำแบบทดสอบหลังอ่านเพื่อรับคอยน์ทั้งหมด + โบนัสข้อที่ตอบถูก" : "",
  });
  document.getElementById("quizBody").innerHTML = `<div class="round-summary">${lines
    .map((l) => `<p>${escapeHtml(l)}</p>`)
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
// ก่อนอ่าน: ไม่บอกผล มีปุ่ม "ยังไม่รู้" | หลังอ่าน: สลับแท็บระหว่างข้อ = ข้อนั้นผิด, ไม่เฉลยข้อที่ผิด

const OPTION_LABELS = ["ก", "ข", "ค", "ง"];
const TEST_COPY = {
  pre: {
    kicker: "แบบทดสอบก่อนอ่าน",
    hint: "ตอบตามที่รู้ตอนนี้ ไม่มีผลกับคอยน์ ข้อละ 1 นาที ถ้ายังไม่รู้กด \"ยังไม่รู้\" ได้เลย",
    leave: "ทำทีหลัง",
  },
  post: {
    kicker: "แบบทดสอบหลังอ่าน",
    hint: "ข้อละ 1 นาที · ห้ามสลับแท็บ (สลับแท็บ = ข้อนั้นผิด) · ทำครบเพื่อรับคอยน์ + โบนัสข้อละ 10 คอยน์",
    leave: "ออกก่อน",
  },
};

let quiz = null; // { chapter, phase, onFinished, question, timerId, deadline, tabSwitched, busy }

async function runChapterTest(chapter, phase, onFinished) {
  quiz = { chapter, phase, onFinished, question: null, timerId: null, deadline: 0, tabSwitched: false, busy: true };
  const copy = TEST_COPY[phase];
  openQuizPanel({ kicker: copy.kicker, title: `Chapter ${chapter.chapter_number} ${chapter.title}`, hint: copy.hint });
  document.getElementById("quizBody").innerHTML = `<p class="quiz-loading">กำลังโหลดคำถาม...</p>`;
  setQuizButtons(null, { label: copy.leave, onClick: leaveTest });

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
  const unknownHtml = q.allowUnknown
    ? `<button type="button" class="quiz-option quiz-option-unknown" data-picked="0">ยังไม่รู้</button>`
    : "";

  const body = document.getElementById("quizBody");
  body.innerHTML = `
    <div class="quiz-timer" aria-live="polite">
      <div class="quiz-timer-bar"><div class="quiz-timer-fill" id="quizTimerFill"></div></div>
      <span class="quiz-timer-text" id="quizTimerText"></span>
    </div>
    <p class="quiz-question">${escapeHtml(q.question)}</p>
    <div class="quiz-options">${optionsHtml}${unknownHtml}</div>
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

function finishTest(summary) {
  clearInterval(quiz.timerId);
  quiz.question = null;
  if (summary.phase === "pre") {
    document.getElementById("quizTitle").textContent = "ทำแบบทดสอบก่อนอ่านเสร็จแล้ว ✅";
    document.getElementById("quizHint").style.display = "none";
    document.getElementById("quizBody").innerHTML =
      `<p class="round-summary">เริ่มอ่านได้เลย! อ่านครบเวลาของบทนี้แล้วจะได้ทำแบบทดสอบหลังอ่าน (ข้อเดิม) เพื่อดูว่าเข้าใจขึ้นแค่ไหน 📖</p>`;
    setQuizButtons({ label: "เริ่มอ่าน", onClick: () => endTest(true) }, null);
    return;
  }
  showTestResults(summary);
}

// ผลแบบทดสอบหลังอ่าน: คะแนนก่อน → หลัง, คอยน์ที่ได้, ข้อไหนถูก/ผิด (ข้อที่ผิดไม่เฉลย ให้กลับไปอ่านแล้วเจอซ้ำในเกม/ครั้งหน้า)
function showTestResults(summary) {
  const scoreText = summary.preScore != null
    ? `ก่อนอ่าน ${summary.preScore}/${summary.total} → หลังอ่าน ${summary.postScore}/${summary.total}`
    : `หลังอ่าน ${summary.postScore}/${summary.total}`;
  document.getElementById("quizKicker").textContent = "ผลแบบทดสอบหลังอ่าน";
  document.getElementById("quizTitle").textContent = scoreText;
  document.getElementById("quizHint").style.display = "none";

  const answerText = (q, picked) => (picked ? `${OPTION_LABELS[picked - 1]}. ${escapeHtml(q.options[picked - 1])}` : "ไม่ได้ตอบ");
  const rows = summary.results
    .map((q, i) => {
      let detail;
      if (q.correct) detail = `✅ ${answerText(q, q.postPicked)}`;
      else if (q.tabSwitched) detail = "❌ สลับแท็บระหว่างทำข้อนี้";
      else if (q.timedOut) detail = "❌ หมดเวลา";
      else detail = `❌ ${answerText(q, q.postPicked)}`;
      return `
        <li class="quiz-result-item">
          <p class="quiz-result-question">${i + 1}. ${escapeHtml(q.question)}</p>
          <p class="quiz-result-line">${detail}</p>
        </li>`;
    })
    .join("");
  const wrongCount = summary.results.filter((q) => !q.correct).length;
  const passNote = summary.passed ? "✅ ผ่านบทนี้แล้ว (นับเป็นเงื่อนไขแลกคูปอง) · " : "";
  const unlockNote = `${passNote}🎮 โลกที่ ${quiz.chapter.chapter_number} ในเกมเปิดแล้ว ไปทบทวนกันเลย!`;

  document.getElementById("quizBody").innerHTML = `
    <div class="quiz-coins">
      <p>คอยน์จากเวลาอ่าน ${summary.coinsTime} + โบนัสตอบถูก ${summary.coinsBonus} = <strong>${summary.coinsTime + summary.coinsBonus} คอยน์</strong> 🎉</p>
      <p class="quiz-coins-sub">เหรียญรวม ${summary.totalCoins} · โบนัสข้อละ ${summary.bonusPerCorrect} คอยน์ (ข้อที่เคยตอบถูกแล้วไม่ได้ซ้ำ)</p>
    </div>
    <ol class="quiz-results">${rows}</ol>
    ${wrongCount ? `<p class="quiz-hint">ข้อที่ผิดยังไม่เฉลยนะ ลองกลับไปอ่านดู — ข้อเหล่านี้จะถูกถามก่อนในเกมทบทวนและครั้งหน้าที่อ่านบทนี้</p>` : ""}
    <p class="quiz-unlock">${unlockNote}</p>
  `;
  updateCoinBadge(summary.totalCoins);
  setQuizButtons({ label: "ตกลง", onClick: () => endTest(true) }, null);
}

// ================== ช่วงพักหลังอ่านจบ (นับถอยหลังฝั่ง client ล้วนๆ ไม่มี session ผูกอยู่แล้ว) ==================

function startBreakCountdown(totalSeconds) {
  onBreak = true;

  const btn = document.getElementById("readerStartStopBtn");
  btn.textContent = "ข้ามพัก";
  btn.classList.remove("is-running");
  btn.classList.add("on-break");

  remainingSeconds = totalSeconds;
  updateBreakClockDisplay(remainingSeconds);
  resumeBreakCountdown();
}

function resumeBreakCountdown() {
  clearInterval(breakCountdownInterval);
  breakCountdownInterval = setInterval(() => {
    remainingSeconds -= 1;
    updateBreakClockDisplay(Math.max(0, remainingSeconds));
    // ไม่เล่นเสียงเตือนตอนพักใกล้หมด (เฉพาะเวลาอ่านใกล้หมดเท่านั้น — user ตั้งใจให้เตือนแค่ตอนอ่าน)

    if (remainingSeconds <= 0) {
      finishBreak(true);
    }
  }, 1000);
}

function pauseBreakCountdown() {
  clearInterval(breakCountdownInterval);
}

function finishBreak(completedNaturally) {
  clearInterval(breakCountdownInterval);
  onBreak = false;

  if (completedNaturally) {
    alert("พักครบเวลาแล้ว พร้อมกลับไปอ่านบทต่อไปได้เลย! 💪");
  }

  resetReaderTimerState();
}

// เคลียร์ session + ปิดหน้าจออ่าน PDF กลับไปหน้า Dashboard ปกติ (เรียกตอนอ่านจบไม่มีพัก, ตอนพักครบ/ข้ามพัก, และตอนหยุดก่อนเวลา)
function resetReaderTimerState() {
  clearInterval(countdownInterval);
  clearInterval(breakCountdownInterval);
  // ปิดเสียงเตือนถ้ายังเล่นค้างอยู่ (เช่น user กดยกเลิกช่วง 5 วิสุดท้าย)
  timerEndSounds.forEach((audio) => {
    try {
      audio.pause();
      audio.currentTime = 0;
    } catch (_) {}
  });
  activeSession = null;
  sessionPhase = null;
  remainingSeconds = 0;
  onBreak = false;

  closeReaderView();
  document.getElementById("readerPdfFrame").src = "";
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

  // สลับแท็บ/ย่อหน้าต่างระหว่างจับเวลา: หยุดนับถอยหลังไว้ก่อน แล้วนับต่อจากเดิมตอนกลับมาที่แท็บนี้
  // ระหว่างอ่าน แจ้ง server ด้วย เพื่อไม่ให้ช่วงที่ออกไปถูกนับเป็นเวลาอ่านตอนคิดเหรียญ
  let awayStartedAt = null;
  document.addEventListener("visibilitychange", () => {
    // นับเฉพาะช่วงกำลังอ่าน — ตอนทำแบบทดสอบก่อน/หลังอ่านไม่มีนาฬิกาเดินอยู่
    const reading = activeSession && sessionPhase === "reading";
    if (document.hidden) {
      if (reading) {
        pauseCountdown();
        awayStartedAt = Date.now();
        // keepalive ให้ request ส่งออกไปได้แม้เบราว์เซอร์กำลังพักแท็บ/ปิดหน้า
        apiFetch(`/sessions/${activeSession.id}/away`, { method: "POST", keepalive: true }).catch(() => {});
      }
      if (onBreak) pauseBreakCountdown();
    } else {
      if (reading) {
        const awaySeconds = awayStartedAt ? Math.round((Date.now() - awayStartedAt) / 1000) : 0;
        awayStartedAt = null;
        apiFetch(`/sessions/${activeSession.id}/back`, { method: "POST" }).catch(() => {});
        if (awaySeconds >= AWAY_NOTICE_MIN_SECONDS) {
          alert(`คุณออกจากหน้าอ่านไป ${formatAwayDuration(awaySeconds)}\nช่วงเวลานี้จะไม่ถูกนับเป็นเวลาอ่านนะ 📖`);
        }
        resumeCountdown();
      }
      if (onBreak) resumeBreakCountdown();
    }
  });
}