// ================== คำแนะนำการใช้งานแบบชี้ปุ่ม (coach marks) ==================
// แต่ละหน้าเรียก startPageTour("<หน้า>") หลังโหลดข้อมูลเสร็จ → แสดงครั้งแรกที่เข้าหน้านั้นครั้งเดียว (จำไว้ในเบราว์เซอร์)
// ปุ่ม ? มุมซ้ายล่าง กดดูคำแนะนำของหน้านั้นซ้ำได้ | หน้าละ 4-5 จุด ชี้เฉพาะสิ่งที่เดาเองไม่ได้
// ส่วนอื่นของหน้ามืดลง จุดที่อธิบายสว่างพร้อมกรอบส้ม | มือถือ: กล่องคำอธิบายเป็นแผ่นขอบล่าง/บนจอ ไม่บังจุดที่ชี้

const TOUR_VERSION = 2; // เปลี่ยนเลขเมื่อแก้คำแนะนำมาก ให้ทุกคนเห็นใหม่อีกครั้ง

// เสียงสั้น ๆ ทุกครั้งที่ชี้จุดใหม่ (จุดแรกที่ขึ้นเองตอนเปิดหน้า บางเบราว์เซอร์อาจไม่ดังเพราะผู้ใช้ยังไม่ได้แตะหน้าเว็บ — ไม่เป็นไร)
const TOUR_STEP_SOUND = new Audio("sound/tour-step.m4a");
TOUR_STEP_SOUND.preload = "auto";
TOUR_STEP_SOUND.volume = 0.6;

function playTourStepSound() {
  try {
    TOUR_STEP_SOUND.currentTime = 0;
    TOUR_STEP_SOUND.play().catch(() => {});
  } catch (_) {}
}

const TOURS = {
  home: [
    {
      sel: ".chapter-card",
      title: "📖 เลือกบทที่จะอ่าน",
      text: "กดที่การ์ดเพื่อเริ่มอ่านรอบละ 25 นาที ป้ายบนการ์ดบอกสถานะของบท เช่น กำลังอ่าน / พร้อมทำแบบทดสอบ / ผ่านแล้ว",
    },
    {
      sel: ".coin-pill",
      title: '<img src="img/coin_ja.png" alt="คอยน์" class="coin-inline"> คอยน์',
      text: 'ได้จากเวลาอ่าน แต่จะเข้าบัญชีหลังทำ "แบบทดสอบหลังอ่าน" ของบทนั้น ตอบถูกได้โบนัสเพิ่ม (ได้คอยน์จากการอ่านวันละไม่เกิน 4 รอบ)',
    },
    {
      sel: "#openModalBtn",
      title: "🎯 เป้าหมายเวลาอ่าน",
      text: "ตั้งเวลาที่อยากอ่านต่อวัน แล้วดูความคืบหน้าได้ที่หน้าแดชบอร์ด",
    },
    {
      sel: "#chatBubbleBtn",
      title: "🐶 ถามน้องหมา",
      text: "ไม่เข้าใจตรงไหน ถามน้องหมาเรื่องบทเรียนหรือเรื่องสุนัขได้ วันละ 8 ข้อ",
    },
    {
      sel: "#tourHelpBtn",
      title: "❓ ดูคำแนะนำอีกครั้ง",
      text: "ทุกหน้ามีปุ่มนี้ (เหนือปุ่มน้องหมา) กดเมื่อไหร่ก็ได้เพื่อดูคำแนะนำของหน้านั้นอีกครั้ง",
    },
  ],
  reader: [
    {
      sel: ".reader-toolbar > .reader-timer-group:first-child",
      title: "⏱️ เวลาอ่าน",
      text: "อ่านรอบละ 25 นาที ถ้าสลับไปแท็บหรือแอปอื่น นาฬิกาจะหยุดและไม่นับเวลาช่วงนั้น",
    },
    {
      sel: "#pdfToolbar",
      title: "📄 เปลี่ยนหน้า / ซูม",
      text: "เลื่อนหน้า กระโดดไปหน้าที่ต้องการ หรือซูมเข้า-ออก ครั้งหน้าที่เปิดบทนี้จะเปิดต่อจากหน้าเดิม",
    },
    {
      sel: ".reader-toolbar > .reader-timer-group:nth-child(2)",
      title: "☕ เวลาพัก",
      text: "อ่านครบแล้วพัก 5 นาที มีเพลงคลอ (กด 🎵 เพื่อปิดได้) พักครบมีเสียงเตือนให้กลับมาอ่านรอบต่อไป",
    },
    {
      sel: "#readerStartStopBtn",
      title: "⏹️ หยุดอ่าน",
      text: "หยุดก่อนครบเวลาได้ คิดคอยน์ตามเวลาที่อ่านจริง และคอยน์จะเข้าหลังทำแบบทดสอบหลังอ่านของบทนี้",
    },
  ],
  pet: [
    {
      sel: "#petStreak",
      title: "🔥 อ่านทุกวัน น้องหมาดีใจ",
      text: "ป้ายนี้บอกว่าอ่านติดกันกี่วัน ถ้าไม่ได้อ่าน 2 วันขึ้นไป น้องจะเหงา ลูบหัวหรือให้ของเล่นช่วยได้ไม่เกินครึ่ง ต้องกลับไปอ่านด้วยกันถึงจะหายเหงา",
    },
    {
      sel: "#petCharacter",
      title: "🖐️ ลูบหัวน้อง",
      text: "กดค้างที่ตัวน้องเพื่อลูบหัว เพิ่มความสุขได้ฟรี",
    },
    {
      sel: ".pet-actions",
      title: "🍽️ สถานะของน้อง",
      text: "ความอิ่ม ความสะอาด ความสุข พลังงาน ลดลงทุกวัน กดปุ่มแล้วเลือกไอเทมจากกระเป๋าเพื่อเติม (ซื้อไอเทมที่ร้านค้าด้วยคอยน์) ⚠️ = ใกล้หมดแล้ว",
    },
    {
      sel: ".right-status .inventory-trigger",
      title: "🎮 เกมทบทวน",
      text: "ทบทวนบทที่ทำแบบทดสอบหลังอ่านแล้ว ข้อที่เคยตอบผิดจะถูกถามก่อน ผ่านด่านได้คอยน์และนับเป็นเงื่อนไขแลกคูปอง",
    },
    {
      sel: ".help-link",
      title: "📘 วิธีเลี้ยง",
      text: "อ่านวิธีดูแลน้องทั้งหมดได้ที่นี่",
    },
  ],
  shop: [
    {
      sel: ".category-tabs",
      title: "🛍️ เลือกหมวด",
      text: "อาหาร ของเล่น อาบน้ำ เครื่องนอน เสื้อผ้า สำหรับน้องหมา",
    },
    {
      sel: "#productGrid .product-card",
      title: '<img src="img/coin_ja.png" alt="คอยน์" class="coin-inline"> ซื้อด้วยคอยน์',
      text: "ซื้อไอเทมด้วยคอยน์ที่ได้จากการอ่าน แล้วไปใช้กับน้องหมาที่หน้าสัตว์เลี้ยง",
    },
    {
      sel: ".category-tabs .tab-btn:last-child",
      title: "🎫 คูปองส่วนลดร้านจริง",
      text: "แลกด้วยคอยน์ + ต้องผ่านแบบทดสอบหลังอ่านตามจำนวนบทที่กำหนด (คูปองใหญ่ต้องผ่านด่านในเกมด้วย) และยืนยันอีเมลมหาวิทยาลัยก่อน",
    },
    {
      sel: ".cart-icon-container",
      title: "🧺 ตะกร้า",
      text: "ใส่หลายชิ้นแล้วซื้อทีเดียวได้",
    },
  ],
  dashboard: [
    {
      sel: ".weekly-summary-card",
      title: "🐶 สัปดาห์นี้เทียบกับสัปดาห์ก่อน",
      text: "ดูว่าตอบถูกมากขึ้นหรือน้อยลง อ่านนานแค่ไหน กราฟบอก % ตอบถูก 4 สัปดาห์เทียบเกณฑ์ 80% ถ้าแย่ลงจะมีปุ่มพาไปทบทวน",
    },
    {
      sel: ".ws-card",
      title: "🐾 สรุป 7 วันจากน้องหมา",
      text: "น้องหมาเก็บผลการเรียน 7 วันล่าสุดมาสรุปให้ 3 หัวข้อ: อ่านบทไหนไปบ้าง · คะแนนก่อนอ่านเทียบหลังอ่านดีขึ้นแค่ไหน · ยังพลาดเรื่องอะไรบ่อย ข้อความปิดท้ายเขียนด้วย AI จากตัวเลขชุดเดียวกับที่เห็นในการ์ด (ระบบตรวจตัวเลขซ้ำก่อนแสดง) สรุปใหม่วันละครั้ง จะเห็นผลของวันนี้ในสรุปของพรุ่งนี้",
    },
    {
      sel: ".goal-section",
      title: "🎯 เป้าหมายวันนี้",
      text: "อ่านไปแล้วกี่เปอร์เซ็นต์ของเป้าหมายวันนี้ (ตั้งเป้าหมายได้ที่หน้าหลัก)",
    },
    {
      sel: ".chart-section",
      title: "📊 เวลาอ่านเทียบเป้าหมาย",
      text: "เวลาอ่านแต่ละสัปดาห์เทียบกับเป้าหมาย",
    },
    {
      sel: "#focusChart",
      title: "📚 อ่านบทไหนมาก",
      text: "เวลาที่อ่านแต่ละบท ดูได้ว่าบทไหนยังอ่านน้อย",
    },
  ],
};

let tourState = null; // { key, steps, index }
// หน้าที่มีหลายโหมดในหน้าเดียว (หน้าหลัก ↔ หน้าอ่าน) บอกได้ว่าตอนนี้ปุ่ม ? ควรเปิดคำแนะนำชุดไหน
let tourKeyResolver = null;

function setTourKeyResolver(fn) {
  tourKeyResolver = fn;
}

function tourStorageKey(key) {
  return `tourSeen:${key}:v${TOUR_VERSION}`;
}

function tourSeen(key) {
  try {
    return localStorage.getItem(tourStorageKey(key)) === "1";
  } catch {
    return false;
  }
}

function markTourSeen(key) {
  try {
    localStorage.setItem(tourStorageKey(key), "1");
  } catch {
    // ปิด storage อยู่ — ครั้งหน้าก็เห็นอีกรอบ ไม่เป็นไร
  }
}

function tourTargetVisible(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
}

function ensureTourHelpButton(key) {
  let btn = document.getElementById("tourHelpBtn");
  if (!btn) {
    btn = document.createElement("button");
    btn.type = "button";
    btn.id = "tourHelpBtn";
    btn.className = "tour-help-btn";
    btn.textContent = "?";
    btn.title = "ดูคำแนะนำการใช้งานหน้านี้";
    btn.setAttribute("aria-label", btn.title);
    document.body.appendChild(btn);
  }
  btn.onclick = () => startPageTour(tourKeyResolver ? tourKeyResolver() : key, { force: true });
}

// แสดงคำแนะนำของหน้า — ครั้งแรกที่เข้าหน้านั้นเท่านั้น (force = กดปุ่ม ? ดูซ้ำ)
function startPageTour(key, { force = false } = {}) {
  const steps = TOURS[key];
  if (!steps) return;
  if (key !== "reader") ensureTourHelpButton(key);
  if (tourState || (!force && tourSeen(key))) return;
  // ข้ามจุดที่ไม่มี/มองไม่เห็นในหน้านี้ (เช่น ยังไม่มีสินค้า, ใช้ตัวแสดง PDF แบบเดิม)
  const available = steps.filter((s) => tourTargetVisible(document.querySelector(s.sel)));
  if (!available.length) return;
  markTourSeen(key);
  tourState = { key, steps: available, index: 0 };
  document.addEventListener("keydown", onTourKey);
  window.addEventListener("resize", repositionTour);
  window.addEventListener("scroll", repositionTour, true);
  renderTourStep();
}

function endTour() {
  removeTourLayers();
  tourState = null;
  document.removeEventListener("keydown", onTourKey);
  window.removeEventListener("resize", repositionTour);
  window.removeEventListener("scroll", repositionTour, true);
}

function nextTourStep() {
  if (!tourState) return;
  if (tourState.index >= tourState.steps.length - 1) endTour();
  else {
    tourState.index += 1;
    renderTourStep();
  }
}

function onTourKey(e) {
  if (e.key === "Escape") endTour();
  else if (e.key === "ArrowRight") nextTourStep();
}

function removeTourLayers() {
  document.querySelectorAll(".tour-spot, .tour-dim, .tour-tip").forEach((el) => el.remove());
}

function renderTourStep() {
  removeTourLayers();
  const { steps, index } = tourState;
  const step = steps[index];
  const el = document.querySelector(step.sel);
  if (!tourTargetVisible(el)) return nextTourStep();

  const isPhone = window.innerWidth <= 600;
  el.scrollIntoView({ block: isPhone ? "center" : "nearest", inline: "nearest" });

  const last = index === steps.length - 1;
  const tip = document.createElement("div");
  tip.className = "tour-tip";
  tip.setAttribute("role", "dialog");
  tip.setAttribute("aria-live", "polite");
  tip.innerHTML = `
    <div class="tour-arrow"></div>
    <h4 class="tour-title"></h4>
    <p class="tour-text"></p>
    <div class="tour-foot">
      <span class="tour-count">${index + 1} / ${steps.length}</span>
      <span class="tour-actions">
        ${last ? "" : '<button type="button" class="tour-skip">ข้าม</button>'}
        <button type="button" class="tour-next">${last ? "เข้าใจแล้ว!" : "ถัดไป"}</button>
      </span>
    </div>`;
  tip.querySelector(".tour-title").innerHTML = step.title;
  tip.querySelector(".tour-text").textContent = step.text;
  tip.querySelector(".tour-next").addEventListener("click", nextTourStep);
  const skip = tip.querySelector(".tour-skip");
  if (skip) skip.addEventListener("click", endTour);
  document.body.appendChild(tip);

  placeTour(el);
  tip.querySelector(".tour-next").focus({ preventScroll: true });
  playTourStepSound();
}

// วางชั้นมืด 4 แผ่นรอบจุดที่ชี้ + กรอบส้ม + กล่องคำอธิบาย (ใต้หรือเหนือจุด แล้วแต่ที่ว่าง)
function placeTour(el) {
  document.querySelectorAll(".tour-spot, .tour-dim").forEach((n) => n.remove());
  const tip = document.querySelector(".tour-tip");
  const r = el.getBoundingClientRect();
  const W = window.innerWidth;
  const H = window.innerHeight;
  const pad = 6;
  const s = { top: r.top - pad, left: r.left - pad, width: r.width + pad * 2, height: r.height + pad * 2 };

  const spot = document.createElement("div");
  spot.className = "tour-spot";
  Object.assign(spot.style, { top: `${s.top}px`, left: `${s.left}px`, width: `${s.width}px`, height: `${s.height}px` });
  document.body.appendChild(spot);
  [
    [0, 0, W, s.top],
    [0, s.top + s.height, W, H - s.top - s.height],
    [0, s.top, s.left, s.height],
    [s.left + s.width, s.top, W - s.left - s.width, s.height],
  ].forEach(([x, y, w, h]) => {
    const dim = document.createElement("div");
    dim.className = "tour-dim";
    Object.assign(dim.style, { left: `${x}px`, top: `${y}px`, width: `${Math.max(0, w)}px`, height: `${Math.max(0, h)}px` });
    document.body.appendChild(dim);
  });

  tip.classList.remove("below", "above", "sheet-top");
  if (W <= 600) {
    // มือถือ: แผ่นเต็มกว้างขอบล่าง ถ้าจุดที่ชี้อยู่ครึ่งล่างของจอ ย้ายไปขอบบน
    tip.style.top = "";
    tip.style.left = "";
    tip.classList.toggle("sheet-top", r.top + r.height / 2 > H / 2);
    return;
  }
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  const gap = 16;
  const below = r.bottom + gap + th < H || r.top - gap - th < 0;
  tip.classList.add(below ? "below" : "above");
  tip.style.top = `${below ? r.bottom + gap : r.top - gap - th}px`;
  const left = Math.min(Math.max(16, r.left + r.width / 2 - tw / 2), W - tw - 16);
  tip.style.left = `${left}px`;
  tip.querySelector(".tour-arrow").style.left = `${Math.min(tw - 28, Math.max(12, r.left + r.width / 2 - left - 8))}px`;
}

let tourRepositionFrame = null;
function repositionTour() {
  if (!tourState || tourRepositionFrame) return;
  tourRepositionFrame = requestAnimationFrame(() => {
    tourRepositionFrame = null;
    if (!tourState) return;
    const el = document.querySelector(tourState.steps[tourState.index].sel);
    if (tourTargetVisible(el)) placeTour(el);
  });
}
