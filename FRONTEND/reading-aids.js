// ================== ตัวช่วยระหว่างอ่าน/พัก (ใช้ในหน้าอ่านหนังสือ index.html) ==================
// 1) Wake Lock: กันหน้าจอดับระหว่างจับเวลา — จอดับ = เบราว์เซอร์ถือว่าหน้าเว็บถูกซ่อน → ระบบหักเป็นเวลาที่ออกจากหน้าอ่าน
// 2) เพลงตอนพัก: เปิดเป็นค่าเริ่มต้น ปิดได้ (จำค่าไว้) เปลี่ยนเพลงทุก 4 รอบพัก ค่อยๆ เบาลงก่อนพักหมด
// 3) พักครบ: เสียงกริ่ง + แจ้งเตือนเด้ง (กดแล้วกลับมาหน้านี้) + ชื่อแท็บกะพริบ ถ้าผู้ใช้อยู่แท็บอื่น
//    แจ้งเตือนผ่าน Service Worker (sw.js) เพราะ Chrome บน Android ไม่ให้สร้างแจ้งเตือนจากหน้าเว็บตรงๆ
//    iPhone ใช้ได้เฉพาะตอนเพิ่มเว็บไว้ที่หน้าจอโฮม — ไม่อย่างนั้นได้แค่เสียงกริ่ง

// ---------- Wake Lock ----------
let wakeLockSentinel = null;
let wakeLockWanted = false;

async function acquireWakeLock() {
  if (!("wakeLock" in navigator) || document.hidden || wakeLockSentinel) return;
  try {
    wakeLockSentinel = await navigator.wakeLock.request("screen");
    wakeLockSentinel.addEventListener("release", () => {
      wakeLockSentinel = null;
    });
  } catch (err) {
    console.warn("ขอให้หน้าจอไม่ดับไม่สำเร็จ:", err);
  }
}

function keepScreenOn() {
  wakeLockWanted = true;
  acquireWakeLock();
}

function allowScreenOff() {
  wakeLockWanted = false;
  if (wakeLockSentinel) {
    wakeLockSentinel.release().catch(() => {});
    wakeLockSentinel = null;
  }
}

// ---------- เพลงตอนพัก ----------
const BREAK_TRACKS = ["sound/break-music-1.m4a", "sound/break-music-2.m4a"];
const BREAKS_PER_TRACK = 4; // รอบพักที่ 1-4 ของวันใช้เพลงแรก 5-8 เพลงที่สอง แล้ววนกลับ
const BREAK_MUSIC_VOLUME = 0.5;
const BREAK_FADE_SECONDS = 8;
const BREAK_MUSIC_MUTED_KEY = "breakMusicMuted";

// ใช้ element เดียวตลอด (เปลี่ยนแค่ไฟล์เพลง) — Safari/มือถืออนุญาตให้ element ที่ "ปลดล็อก" แล้วเล่นเองได้ (ดู unlockAudio ข้างล่าง)
const breakPlayer = new Audio();
breakPlayer.loop = true; // เวลาพักยาวกว่าเพลงก็วนซ้ำ — ตัวจับเวลาเป็นคนตัดสินว่าพักหมดเมื่อไหร่
let breakAudio = null; // = breakPlayer ระหว่างพัก, null เมื่อไม่ได้เล่น

function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // โหมดส่วนตัว/ปิด storage — ใช้ค่าเริ่มต้นไป
  }
}

function breakMusicMuted() {
  return readStorage(BREAK_MUSIC_MUTED_KEY) === "1";
}

function localDateKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// นับรอบพักของวันนี้ แล้วเลือกเพลง (เปลี่ยนเพลงทุก 4 รอบ)
function nextBreakTrack() {
  const key = `breakCount:${localDateKey()}`;
  const count = (Number(readStorage(key)) || 0) + 1;
  writeStorage(key, String(count));
  return BREAK_TRACKS[Math.floor((count - 1) / BREAKS_PER_TRACK) % BREAK_TRACKS.length];
}

function startBreakMusic() {
  stopBreakMusic();
  breakAudio = breakPlayer;
  breakAudio.src = nextBreakTrack();
  breakAudio.volume = BREAK_MUSIC_VOLUME;
  breakAudio.muted = breakMusicMuted();
  breakAudio.play().catch((err) => console.warn("เล่นเพลงตอนพักไม่สำเร็จ:", err));
  updateBreakMusicButton();
}

// ค่อยๆ ลดเสียงช่วง 8 วินาทีสุดท้ายของการพัก
function fadeBreakMusic(secondsLeft) {
  if (!breakAudio) return;
  if (secondsLeft <= BREAK_FADE_SECONDS) {
    breakAudio.volume = BREAK_MUSIC_VOLUME * (Math.max(0, secondsLeft) / BREAK_FADE_SECONDS);
  }
}

function stopBreakMusic() {
  if (breakAudio) {
    breakAudio.pause();
    breakAudio = null;
  }
  updateBreakMusicButton();
}

function toggleBreakMusic() {
  const muted = !breakMusicMuted();
  writeStorage(BREAK_MUSIC_MUTED_KEY, muted ? "1" : "0");
  if (breakAudio) breakAudio.muted = muted;
  updateBreakMusicButton();
}

function updateBreakMusicButton() {
  const btn = document.getElementById("breakMusicBtn");
  if (!btn) return;
  const muted = breakMusicMuted();
  btn.style.display = breakAudio ? "" : "none";
  btn.textContent = muted ? "🔇" : "🎵";
  btn.title = muted ? "เปิดเพลงตอนพัก" : "ปิดเพลงตอนพัก";
  btn.setAttribute("aria-label", btn.title);
  btn.setAttribute("aria-pressed", String(!muted));
}

// ---------- ปลดล็อกเสียงด้วยการแตะ/กดของผู้ใช้ ----------
// Safari และเบราว์เซอร์บนมือถือบล็อกเสียงที่เริ่มเล่นเองโดยไม่ได้มาจากการกด (เช่น เพลงนับถอยหลังตอนเหลือ 11 วิ, เพลงตอนพัก)
// แก้โดย: ตอนผู้ใช้แตะ/กดอะไรก็ได้ ให้ element เสียงเล่นแบบปิดเสียงแล้วหยุดทันที element นั้นจะเล่นเองได้ในภายหลัง
const SILENT_WAV = "data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YSADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";
const unlockableAudio = new Set([breakPlayer]);
const unlockedAudio = new WeakSet();

function registerUnlockableAudio(audio) {
  unlockableAudio.add(audio);
}

function unlockAudio() {
  unlockableAudio.forEach((audio) => {
    if (unlockedAudio.has(audio) || !audio.paused) return;
    const hadSrc = !!audio.getAttribute("src");
    if (!hadSrc) audio.src = SILENT_WAV;
    audio.muted = true;
    const restore = () => {
      audio.pause();
      audio.muted = audio === breakPlayer ? breakMusicMuted() : false;
      if (hadSrc) audio.currentTime = 0;
      else audio.removeAttribute("src");
    };
    audio
      .play()
      .then(() => {
        unlockedAudio.add(audio);
        restore();
      })
      .catch(restore);
  });
}

document.addEventListener("pointerdown", unlockAudio, true);
document.addEventListener("keydown", unlockAudio, true);

// ---------- เสียงกริ่งตอนพักครบ (สร้างด้วย Web Audio ไม่ต้องใช้ไฟล์) ----------
function playBreakEndChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    [
      [880, 0],
      [1175, 0.18],
      [1568, 0.36],
    ].forEach(([freq, at]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = ctx.currentTime + at;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.3, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.6);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.65);
    });
    setTimeout(() => ctx.close().catch(() => {}), 1500);
  } catch (err) {
    console.warn("เล่นเสียงกริ่งไม่สำเร็จ:", err);
  }
}

// ---------- แจ้งเตือน (Notification API ผ่าน Service Worker) ----------
let swRegistration = null;

function registerReadingServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker
    .register("sw.js")
    .then((reg) => {
      swRegistration = reg;
    })
    .catch((err) => console.warn("ลงทะเบียน Service Worker ไม่สำเร็จ:", err));
}

// ขออนุญาตตอนผู้ใช้กดเริ่มพัก (เบราว์เซอร์ให้ขอได้ตอนผู้ใช้กดปุ่มเท่านั้น) ถามครั้งเดียว ปฏิเสธแล้วไม่ถามซ้ำ
function askNotificationPermission() {
  if (!("Notification" in window) || Notification.permission !== "default") return;
  Notification.requestPermission().catch(() => {});
}

async function notifyBreakOver() {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const title = "พักครบแล้ว! ⏰";
  const options = {
    body: "กลับมาอ่านรอบต่อไปกันเถอะ น้องหมารออยู่ 📖🐶",
    icon: "img/NEW_LOGO.png",
    tag: "break-over",
    renotify: true,
  };
  try {
    const reg = swRegistration || (navigator.serviceWorker && (await navigator.serviceWorker.getRegistration()));
    if (reg) {
      await reg.showNotification(title, options);
      return;
    }
  } catch (err) {
    console.warn("แจ้งเตือนผ่าน Service Worker ไม่สำเร็จ:", err);
  }
  try {
    const n = new Notification(title, options);
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch (err) {
    console.warn("แจ้งเตือนไม่สำเร็จ:", err);
  }
}

// ---------- ชื่อแท็บกะพริบ (ตอนผู้ใช้อยู่แท็บอื่น) ----------
let titleBlinkTimer = null;
let titleBeforeBlink = null;

function startTitleBlink(text) {
  stopTitleBlink();
  titleBeforeBlink = document.title;
  let showText = true;
  document.title = text;
  titleBlinkTimer = setInterval(() => {
    showText = !showText;
    document.title = showText ? text : titleBeforeBlink;
  }, 1000);
}

function stopTitleBlink() {
  if (!titleBlinkTimer) return;
  clearInterval(titleBlinkTimer);
  titleBlinkTimer = null;
  document.title = titleBeforeBlink;
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  stopTitleBlink(); // กลับมาที่แท็บนี้แล้ว
  if (wakeLockWanted) acquireWakeLock(); // เบราว์เซอร์ปล่อย Wake Lock เองตอนซ่อนหน้า ต้องขอใหม่
});
