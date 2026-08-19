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
let selectedChapter = null; // chapter ที่กำลังเปิด modal ตั้งเวลาอ่านอยู่
let activeSession = null; // { id, chapterTitle, plannedReadSeconds, plannedBreakSeconds }
let countdownInterval = null;
let remainingSeconds = 0;
let onBreak = false; // true ระหว่างช่วงพักหลังอ่านจบ (session จบไปแล้ว รอนับเวลาพักอย่างเดียว)
let breakCountdownInterval = null;

const MIN_READ_MINUTES = 10;
const MAX_TIME_MINUTES = 120;
const TIME_STEP_MINUTES = 5;

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
  const { chapters } = await apiFetch("/chapters");
  renderChapters(chapters);
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

// ---- ขั้น 1: ป๊อปอัพตั้งเวลาอ่าน/พัก ก่อนเริ่มจับเวลาจริง ----

function openChapterTimeModal(chapter) {
  if (activeSession) {
    alert("คุณกำลังอ่านอยู่แล้ว กรุณาจบเซสชันปัจจุบันก่อน");
    return;
  }

  selectedChapter = chapter;
  document.getElementById("modalChapterTitle").textContent = `Chapter ${chapter.chapter_number} ${chapter.title}`;

  document.getElementById("chapterMinutes").value = MIN_READ_MINUTES;
  document.getElementById("chapterSeconds").value = 0;
  document.getElementById("breakMinutes").value = 0;
  document.getElementById("breakSeconds").value = 0;
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

  const readMinutes = Number(document.getElementById("chapterMinutes").value) || 0;
  const readSeconds = Number(document.getElementById("chapterSeconds").value) || 0;
  const breakMinutes = Number(document.getElementById("breakMinutes").value) || 0;
  const breakSeconds = Number(document.getElementById("breakSeconds").value) || 0;

  if (readMinutes * 60 + readSeconds < MIN_READ_MINUTES * 60) {
    errorEl.textContent = `เวลาอ่านต้องตั้งอย่างน้อย ${MIN_READ_MINUTES} นาที`;
    errorEl.style.display = "block";
    return;
  }
  if (readMinutes > MAX_TIME_MINUTES || breakMinutes > MAX_TIME_MINUTES) {
    errorEl.textContent = `เวลาต้องไม่เกิน ${MAX_TIME_MINUTES} นาที`;
    errorEl.style.display = "block";
    return;
  }

  try {
    const result = await apiFetch(`/chapters/${selectedChapter.id}/sessions`, {
      method: "POST",
      body: JSON.stringify({ readMinutes, readSeconds, breakMinutes, breakSeconds }),
    });

    activeSession = {
      id: result.session.id,
      chapterTitle: result.session.chapterTitle,
      plannedReadSeconds: result.session.plannedReadSeconds,
      plannedBreakSeconds: result.session.plannedBreakSeconds,
    };

    document.getElementById("chapterModal").style.display = "none";
    openReaderView(selectedChapter);
    updateBreakClockDisplay(activeSession.plannedBreakSeconds); // โชว์เวลาพักที่ตั้งไว้ล่วงหน้า (ยังไม่นับถอยหลังจนกว่าจะอ่านจบ)
    startCountdown(activeSession.plannedReadSeconds);
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = "block";
  }
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
  document.getElementById("readerExtendBtn").style.display = "";

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

// readerStartStopBtn ทำหน้าที่ต่างกันตามช่วง: ระหว่างอ่าน = "หยุด" (จบเซสชันก่อนเวลา ได้เหรียญตามเวลาที่อ่านจริง), ระหว่างพัก = "ข้ามพัก"
async function stopReading() {
  if (onBreak) {
    finishBreak(false);
    return;
  }
  if (!activeSession) return;

  const confirmStop = confirm(
    "ต้องการหยุดอ่านตอนนี้เลยหรือไม่? จะได้เหรียญตามเวลาที่อ่านจริง (นับทุกๆ 5 นาทีที่อ่านครบเท่านั้น)"
  );
  if (!confirmStop) return;

  await completeReadingSession(false); // false = จบก่อนเวลา ไม่เข้าสู่ช่วงพัก
}

// ปุ่ม "+5" หน้าอ่าน PDF: เพิ่มเวลาอ่านอีก 5 นาทีระหว่างกำลังอ่านจริง (ฝั่งเซิร์ฟเวอร์เป็นคนเก็บเวลาที่ตั้งไว้ล่าสุด กันไม่ให้ client โกงเวลา)
async function extendReadingTime() {
  if (!activeSession || onBreak) return;

  try {
    const result = await apiFetch(`/sessions/${activeSession.id}/extend`, { method: "POST" });
    activeSession.plannedReadSeconds = result.plannedReadSeconds;
    remainingSeconds += result.addedSeconds;
    updateReaderClockDisplay(remainingSeconds);
  } catch (err) {
    alert(err.message);
  }
}

// ================== เสียงแจ้งเตือนก่อนหมดเวลา 5 วินาที (ไฟล์ buzzer 5 วิ จาก sound/timer-end.mp3) ==================

// preload ตอนโหลดไฟล์ script.js เลย จะได้ไม่ต้องรอโหลดครั้งแรกที่เรียก
// (browser autoplay policy ยอมให้เล่นได้เพราะ user เพิ่งกดปุ่ม "เริ่ม" ไปก่อนหน้า)
const timerEndSound = new Audio("sound/timer-end.mp3");
timerEndSound.preload = "auto";
timerEndSound.volume = 0.7;

function playSoftBeep() {
  try {
    timerEndSound.pause();
    timerEndSound.currentTime = 0; // reset ให้เล่นตั้งแต่ต้นเสมอ (กันกรณีเสียงยังเล่นค้างจากรอบก่อน)
    timerEndSound.play().catch((err) => console.error("เล่นเสียงแจ้งเตือนไม่สำเร็จ:", err));
  } catch (err) {
    console.error("เล่นเสียงแจ้งเตือนไม่สำเร็จ:", err);
  }
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

// จบเซสชันการอ่าน (ทั้งอ่านครบเวลาเองและกด "หยุด" ก่อนเวลา) — ได้เหรียญตามเวลาที่อ่านจริงเสมอ (ปัดลงทุกๆ 5 นาที)
// enterBreakAfter = true เฉพาะตอนอ่านครบเวลาตามธรรมชาติเท่านั้น ถ้าหยุดเองจะปิดหน้าอ่านทันที ไม่เข้าช่วงพัก
async function completeReadingSession(enterBreakAfter) {
  if (!activeSession) return;
  const sessionId = activeSession.id;
  const plannedBreakSeconds = activeSession.plannedBreakSeconds || 0;

  clearInterval(countdownInterval);

  try {
    const result = await apiFetch(`/sessions/${sessionId}/complete`, { method: "POST" });
    updateCoinBadge(result.totalCoins);
    alert(
      `${result.message}\nได้รับ ${result.coinsEarned} เหรียญ 🎉\nเหรียญรวม: ${result.totalCoins}`
    );
  } catch (err) {
    console.error("Complete session error:", err);
    alert("เกิดข้อผิดพลาดในการบันทึกผลการอ่าน: " + err.message);
  }

  activeSession = null; // session จบที่ฝั่งเซิร์ฟเวอร์แล้ว (สำเร็จหรือ error ก็ตาม) ไม่ต้อง cancel ซ้ำได้อีก

  if (enterBreakAfter && plannedBreakSeconds > 0) {
    startBreakCountdown(plannedBreakSeconds);
  } else {
    resetReaderTimerState();
  }
}

// ================== ช่วงพักหลังอ่านจบ (นับถอยหลังฝั่ง client ล้วนๆ ไม่มี session ผูกอยู่แล้ว) ==================

function startBreakCountdown(totalSeconds) {
  onBreak = true;

  const btn = document.getElementById("readerStartStopBtn");
  btn.textContent = "ข้ามพัก";
  btn.classList.remove("is-running");
  btn.classList.add("on-break");
  document.getElementById("readerExtendBtn").style.display = "none"; // เพิ่มเวลาได้เฉพาะตอนอ่านจริง ไม่ใช่ช่วงพัก

  remainingSeconds = totalSeconds;
  updateBreakClockDisplay(remainingSeconds);
  resumeBreakCountdown();
}

function resumeBreakCountdown() {
  clearInterval(breakCountdownInterval);
  breakCountdownInterval = setInterval(() => {
    remainingSeconds -= 1;
    updateBreakClockDisplay(Math.max(0, remainingSeconds));
    if (remainingSeconds === 5) playSoftBeep();

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
  try {
    timerEndSound.pause();
    timerEndSound.currentTime = 0;
  } catch (_) {}
  activeSession = null;
  remainingSeconds = 0;
  onBreak = false;

  closeReaderView();
  document.getElementById("readerPdfFrame").src = "";
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

  document.getElementById("readerStartStopBtn").addEventListener("click", stopReading);
  document.getElementById("readerExtendBtn").addEventListener("click", extendReadingTime);

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
    if (activeSession || onBreak) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  // สลับแท็บ/ย่อหน้าต่างระหว่างจับเวลา: หยุดนับถอยหลังไว้ก่อน แล้วนับต่อจากเดิมตอนกลับมาที่แท็บนี้
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (activeSession) pauseCountdown();
      if (onBreak) pauseBreakCountdown();
    } else {
      if (activeSession) resumeCountdown();
      if (onBreak) resumeBreakCountdown();
    }
  });
}