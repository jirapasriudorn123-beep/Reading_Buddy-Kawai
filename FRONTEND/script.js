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
// ช่วงของรอบการอ่านที่กำลังทำอยู่: 'pre' (แบบทดสอบก่อนอ่าน) → 'reading' → 'post' (แบบทดสอบหลังอ่าน) | null = ไม่มีรอบค้าง
let sessionPhase = null;

// กติกาเวลาอ่าน (backend ส่งมากับ /chapters) — ปกติขั้นต่ำ 10 นาที 10 คอยน์ทุก 5 นาที, โหมดสาธิต 1 นาที 10 คอยน์ทุก 1 นาที
let readingRules = { demoMode: false, minReadMinutes: 10, minutesPerBlock: 5, coinsPerBlock: 10 };
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
  const data = await apiFetch("/chapters");
  if (data.readingRules) readingRules = data.readingRules;
  renderChapters(data.chapters);
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

  const minutesInput = document.getElementById("chapterMinutes");
  minutesInput.value = readingRules.minReadMinutes;
  minutesInput.min = readingRules.minReadMinutes;
  const demoNotice = document.getElementById("demoModeNotice");
  if (demoNotice) {
    demoNotice.style.display = readingRules.demoMode ? "block" : "none";
    demoNotice.textContent = `🧪 โหมดสาธิต: ตั้งเวลาได้ตั้งแต่ ${readingRules.minReadMinutes} นาที · อ่านทุก ${readingRules.minutesPerBlock} นาทีได้ ${readingRules.coinsPerBlock} คอยน์`;
  }
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

  if (readMinutes * 60 + readSeconds < readingRules.minReadMinutes * 60) {
    errorEl.textContent = `เวลาอ่านต้องตั้งอย่างน้อย ${readingRules.minReadMinutes} นาที`;
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
    const chapter = selectedChapter;

    // บทที่มีคำถาม: ทำแบบทดสอบก่อนอ่านก่อน แล้วค่อยเปิด PDF + เริ่มนับเวลา (server เริ่มนับตอนส่งคำตอบ)
    if (result.preTest && result.preTest.length > 0) {
      sessionPhase = "pre";
      openQuiz("pre", result.preTest, {
        onSubmit: async (answers) => {
          await apiFetch(`/sessions/${activeSession.id}/pre-test`, {
            method: "POST",
            body: JSON.stringify({ answers }),
          });
          closeQuiz();
          startReadingPhase(chapter);
        },
        onSecondary: cancelBeforeReading,
      });
    } else {
      startReadingPhase(chapter);
    }
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = "block";
  }
}

function startReadingPhase(chapter) {
  sessionPhase = "reading";
  openReaderView(chapter);
  updateBreakClockDisplay(activeSession.plannedBreakSeconds); // โชว์เวลาพักที่ตั้งไว้ล่วงหน้า (ยังไม่นับถอยหลังจนกว่าจะอ่านจบ)
  startCountdown(activeSession.plannedReadSeconds);
}

// กด "ยกเลิก" ตอนทำแบบทดสอบก่อนอ่าน: ยกเลิกรอบนี้ทั้งรอบ (ยังไม่ได้เริ่มอ่าน)
async function cancelBeforeReading() {
  if (!activeSession) return;
  try {
    await apiFetch(`/sessions/${activeSession.id}/cancel`, { method: "POST" });
  } catch (err) {
    console.error("Cancel session error:", err);
  }
  closeQuiz();
  resetReaderTimerState();
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
  if (!activeSession || sessionPhase !== "reading") return;

  const confirmStop = confirm(
    `ต้องการหยุดอ่านตอนนี้เลยหรือไม่? จะได้เหรียญตามเวลาที่อ่านจริง (นับทุกๆ ${readingRules.minutesPerBlock} นาทีที่อ่านครบเท่านั้น) ` +
      `หลังทำแบบทดสอบหลังอ่าน`
  );
  if (!confirmStop) return;

  await completeReadingSession(false); // false = จบก่อนเวลา ไม่เข้าสู่ช่วงพัก
}

// ปุ่ม "+5" หน้าอ่าน PDF: เพิ่มเวลาอ่านอีก 5 นาทีระหว่างกำลังอ่านจริง (ฝั่งเซิร์ฟเวอร์เป็นคนเก็บเวลาที่ตั้งไว้ล่าสุด กันไม่ให้ client โกงเวลา)
async function extendReadingTime() {
  if (!activeSession || onBreak || sessionPhase !== "reading") return;

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

// จบช่วงอ่าน (ทั้งอ่านครบเวลาเองและกด "หยุด" ก่อนเวลา) — ได้เหรียญตามเวลาที่อ่านจริง (ปัดลงทุกๆ 5 นาที)
// รอบที่มีแบบทดสอบ: คอยน์จะเข้าหลังทำแบบทดสอบหลังอ่านเท่านั้น (ข้าม = ไม่ได้คอยน์รอบนี้)
// enterBreakAfter = true เฉพาะตอนอ่านครบเวลาตามธรรมชาติเท่านั้น ถ้าหยุดเองจะปิดหน้าอ่านทันที ไม่เข้าช่วงพัก
async function completeReadingSession(enterBreakAfter) {
  if (!activeSession || sessionPhase !== "reading") return;
  const sessionId = activeSession.id;

  clearInterval(countdownInterval);
  sessionPhase = "post"; // กันนับถอยหลังต่อตอนสลับแท็บกลับมา ระหว่างรอผล/ทำแบบทดสอบ

  let result;
  try {
    result = await apiFetch(`/sessions/${sessionId}/complete`, { method: "POST" });
  } catch (err) {
    console.error("Complete session error:", err);
    alert("เกิดข้อผิดพลาดในการบันทึกผลการอ่าน: " + err.message);
    finishRound(enterBreakAfter);
    return;
  }

  const awayNote = result.awaySeconds >= AWAY_NOTICE_MIN_SECONDS
    ? `ไม่นับเวลาที่ออกจากหน้าอ่าน ${formatAwayDuration(result.awaySeconds)}`
    : "";

  // บทที่ยังไม่มีคำถาม: ได้คอยน์ทันทีแบบเดิม
  if (!result.postTest) {
    updateCoinBadge(result.totalCoins);
    alert(
      `${result.message}\nได้รับ ${result.coinsEarned} เหรียญ 🎉\nเหรียญรวม: ${result.totalCoins}` +
        (awayNote ? `\n(${awayNote})` : "")
    );
    finishRound(enterBreakAfter);
    return;
  }

  openQuiz("post", result.postTest, {
    coinsPending: result.coinsPending,
    awayNote,
    onSubmit: async (answers) => {
      const graded = await apiFetch(`/sessions/${sessionId}/post-test`, {
        method: "POST",
        body: JSON.stringify({ answers }),
      });
      updateCoinBadge(graded.totalCoins);
      showQuizResults(graded, awayNote, () => {
        closeQuiz();
        finishRound(enterBreakAfter);
      });
    },
    onSecondary: async () => {
      if (!confirm("ถ้าข้ามแบบทดสอบหลังอ่าน รอบนี้จะไม่ได้รับคอยน์ และไม่นับเป็นเวลาอ่าน ต้องการข้ามใช่ไหม?")) return;
      try {
        await apiFetch(`/sessions/${sessionId}/skip-post-test`, { method: "POST" });
      } catch (err) {
        console.error("Skip post-test error:", err);
      }
      closeQuiz();
      finishRound(false);
    },
  });
}

// ปิดรอบการอ่าน (session จบที่ฝั่งเซิร์ฟเวอร์แล้ว ไม่ต้อง cancel ซ้ำได้อีก) แล้วเข้าช่วงพักถ้าอ่านครบเวลาและตั้งเวลาพักไว้
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

// ================== แบบทดสอบก่อนอ่าน/หลังอ่าน (ป๊อปอัพเดียวกัน ถามทีละข้อ) ==================
// ก่อนอ่าน: ไม่เฉลย ไม่มีผลกับคอยน์ มีปุ่ม "ยังไม่รู้" | หลังอ่าน: ข้อเดิม (สลับลำดับ) ต้องทำถึงจะได้คอยน์ แล้วเฉลยเทียบกัน

const QUIZ_COPY = {
  pre: {
    kicker: "แบบทดสอบก่อนอ่าน",
    hint: "ตอบตามที่รู้ตอนนี้ ไม่มีผลกับคอยน์ ถ้ายังไม่รู้ให้กด \"ยังไม่รู้\" ได้เลย",
    secondary: "ยกเลิก",
  },
  post: {
    kicker: "แบบทดสอบหลังอ่าน",
    hint: "คำถามชุดเดิมกับก่อนอ่าน ทำให้ครบเพื่อรับคอยน์ของรอบนี้",
    secondary: "ข้าม (ไม่รับคอยน์)",
  },
};
const OPTION_LABELS = ["ก", "ข", "ค", "ง"];

let quiz = null; // { mode, questions, index, answers, shownAt, handlers }

function openQuiz(mode, questions, handlers) {
  quiz = { mode, questions, index: 0, answers: [], shownAt: 0, handlers };
  const copy = QUIZ_COPY[mode];
  document.getElementById("quizKicker").textContent = copy.kicker;
  let hint = copy.hint;
  if (mode === "post") {
    hint += ` (รอบนี้ได้ ${handlers.coinsPending} คอยน์)`;
    if (handlers.awayNote) hint += ` · ${handlers.awayNote}`;
  }
  document.getElementById("quizHint").textContent = hint;
  document.getElementById("quizHint").style.display = "";

  const secondaryBtn = document.getElementById("quizSecondaryBtn");
  secondaryBtn.textContent = copy.secondary;
  secondaryBtn.style.display = "";
  secondaryBtn.disabled = false;
  document.getElementById("quizPrimaryBtn").style.display = "none";

  renderQuizQuestion();
  document.getElementById("quizModal").style.display = "flex";
}

function closeQuiz() {
  quiz = null;
  document.getElementById("quizModal").style.display = "none";
}

function renderQuizQuestion() {
  const q = quiz.questions[quiz.index];
  document.getElementById("quizError").style.display = "none";
  document.getElementById("quizTitle").textContent = `ข้อ ${quiz.index + 1} / ${quiz.questions.length}`;

  const optionsHtml = q.options
    .map(
      (opt, i) => `
        <button type="button" class="quiz-option" data-picked="${i + 1}">
          <span class="quiz-option-label">${OPTION_LABELS[i]}</span>
          <span>${escapeHtml(opt)}</span>
        </button>`
    )
    .join("");
  const unknownHtml = quiz.mode === "pre"
    ? `<button type="button" class="quiz-option quiz-option-unknown" data-picked="0">ยังไม่รู้</button>`
    : "";

  const body = document.getElementById("quizBody");
  body.innerHTML = `
    <p class="quiz-question">${escapeHtml(q.question)}</p>
    <div class="quiz-options">${optionsHtml}${unknownHtml}</div>
  `;
  body.querySelectorAll(".quiz-option").forEach((btn) => {
    btn.addEventListener("click", () => pickQuizAnswer(Number(btn.dataset.picked)));
  });
  quiz.shownAt = Date.now();
}

async function pickQuizAnswer(picked) {
  if (!quiz) return;
  const q = quiz.questions[quiz.index];
  quiz.answers.push({ position: q.position, picked, ms: Date.now() - quiz.shownAt });

  if (quiz.index + 1 < quiz.questions.length) {
    quiz.index += 1;
    renderQuizQuestion();
    return;
  }

  // ตอบครบแล้ว → ส่งให้ server ตรวจ (กดซ้ำไม่ได้ระหว่างรอ)
  const body = document.getElementById("quizBody");
  body.querySelectorAll("button").forEach((btn) => (btn.disabled = true));
  document.getElementById("quizSecondaryBtn").disabled = true;
  const current = quiz;
  try {
    await current.handlers.onSubmit(current.answers);
  } catch (err) {
    // ส่งไม่สำเร็จ (เช่น เน็ตหลุด) → ให้ตอบใหม่ตั้งแต่ข้อแรก
    if (quiz !== current) return;
    quiz.index = 0;
    quiz.answers = [];
    renderQuizQuestion();
    document.getElementById("quizSecondaryBtn").disabled = false;
    const errorEl = document.getElementById("quizError");
    errorEl.textContent = `ส่งคำตอบไม่สำเร็จ: ${err.message} ลองตอบอีกครั้งนะ`;
    errorEl.style.display = "block";
  }
}

// เฉลยหลังทำแบบทดสอบหลังอ่าน: คะแนนก่อนอ่าน → หลังอ่าน + ข้อไหนถูก/ผิด
function showQuizResults(graded, awayNote, onDone) {
  document.getElementById("quizKicker").textContent = "ผลการอ่านรอบนี้";
  document.getElementById("quizTitle").textContent = `ก่อนอ่าน ${graded.preScore}/${graded.total} → หลังอ่าน ${graded.postScore}/${graded.total}`;
  document.getElementById("quizHint").style.display = "none";
  document.getElementById("quizError").style.display = "none";

  const answerText = (q, picked) => {
    if (!picked) return "ยังไม่รู้";
    return `${OPTION_LABELS[picked - 1]}. ${escapeHtml(q.options[picked - 1])}`;
  };
  const rows = graded.results
    .map((q, i) => {
      const preOk = q.prePicked === q.correctOption;
      const postOk = q.postPicked === q.correctOption;
      return `
        <li class="quiz-result-item">
          <p class="quiz-result-question">${i + 1}. ${escapeHtml(q.question)}</p>
          <p class="quiz-result-line">ก่อนอ่าน: ${preOk ? "✅" : "❌"} ${answerText(q, q.prePicked)}</p>
          <p class="quiz-result-line">หลังอ่าน: ${postOk ? "✅" : "❌"} ${answerText(q, q.postPicked)}</p>
          ${postOk ? "" : `<p class="quiz-result-line quiz-result-answer">เฉลย: ${answerText(q, q.correctOption)}</p>`}
        </li>`;
    })
    .join("");

  document.getElementById("quizBody").innerHTML = `
    <p class="quiz-coins">ได้รับ ${graded.coinsEarned} เหรียญ 🎉 · เหรียญรวม ${graded.totalCoins}</p>
    ${awayNote ? `<p class="quiz-hint">(${escapeHtml(awayNote)})</p>` : ""}
    <ol class="quiz-results">${rows}</ol>
  `;

  document.getElementById("quizSecondaryBtn").style.display = "none";
  const primaryBtn = document.getElementById("quizPrimaryBtn");
  primaryBtn.style.display = "";
  primaryBtn.onclick = onDone;
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

  document.getElementById("quizSecondaryBtn").addEventListener("click", () => {
    if (quiz && quiz.handlers.onSecondary) quiz.handlers.onSecondary();
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