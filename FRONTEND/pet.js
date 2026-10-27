// ================== ตัวช่วยเรียก API ==================

function getToken() {
  return localStorage.getItem("token");
}

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

let currentPet = null; // { breed, name, level, exp }
let selectedBreed = null; // ใช้ตอนอยู่หน้า select-pet.html เท่านั้น

// ================== เริ่มทำงานเมื่อโหลดหน้า ==================

document.addEventListener("DOMContentLoaded", async () => {
  if (!getToken()) {
    window.location.href = "login.html";
    return;
  }

  setupSidebarToggle();
  bindLogout();

  const path = window.location.pathname;

  try {
    const { pet, streak } = await apiFetch("/pet");
    currentPet = pet;
    currentStreak = streak || null;

    await loadUserCoins();

    if (path.includes("select-pet.html")) {
      // ถ้ามีสัตว์เลี้ยงอยู่แล้ว ไม่ต้องให้เลือกซ้ำ ส่งไปหน้า Pet.html เลย
      if (pet) {
        window.location.href = "Pet.html";
        return;
      }
    } else if (path.includes("Pet.html") || path.includes("pet.html")) {
      // ถ้ายังไม่มีสัตว์เลี้ยง ต้องไปเลือกก่อน
      if (!pet) {
        window.location.href = "select-pet.html";
        return;
      }
      renderPetPage(pet);
      setupPetting();
      // คำแนะนำการใช้งาน (ครั้งแรกที่เข้าหน้านี้) — รอรูปน้องหมาโหลดก่อน ตำแหน่งจะได้ไม่ขยับ
      setTimeout(() => startPageTour("pet"), 600);
      // ข้อมูลวิจัย: นับการเข้ามาหาน้องหมา (server นับไม่เกิน 1 ครั้งต่อ 30 นาที) ไม่สำเร็จก็ไม่เป็นไร
      apiFetch("/pet/visit", { method: "POST" }).catch(() => {});
      await loadInventory(); // ของในกระเป๋ามาจากที่ซื้อไว้จริงในร้าน
      loadMyDogs().catch(() => {}); // นับตัวในบ้านไว้โชว์บนปุ่ม "น้องหมาของฉัน"
      // รีเฟรชสถานะทุก 1 นาที เผื่อเปิดหน้าค้างไว้เฉยๆ จะได้เห็นค่าที่ลดลงตามเวลาจริงโดยไม่ต้องกดอะไร
      setInterval(refreshPetStats, 60000);
    }
  } catch (err) {
    console.error("โหลดข้อมูลสัตว์เลี้ยงไม่สำเร็จ:", err);
  }
});

async function refreshPetStats() {
  try {
    const { pet, streak } = await apiFetch("/pet");
    if (!pet) return;
    currentPet = pet;
    currentStreak = streak || null;
    updatePetUI(currentPet);
    renderStreak();
    refreshPetMood();
  } catch (err) {
    console.error("รีเฟรชสถานะสัตว์เลี้ยงไม่สำเร็จ:", err);
  }
}

// ================== เหรียญผู้ใช้ ==================

async function loadUserCoins() {
  const { user } = await apiFetch("/auth/me");
  const coinElement = document.getElementById("coinAmount");
  if (coinElement) coinElement.textContent = user.coins;
}

// ================== Modal ทั่วไป (วิธีเลี้ยง ฯลฯ) ==================

function toggleModal(modalId, show) {
  const modal = document.getElementById(modalId);
  if (modal) modal.style.display = show ? "flex" : "none";
}

// ================== หน้า select-pet.html ==================

function setBreed(breed) {
  selectedBreed = breed;
  document.querySelectorAll(".pet-card").forEach((card) => card.classList.remove("selected"));
  const targetCard = document.getElementById("card-" + breed);
  if (targetCard) targetCard.classList.add("selected");
}

async function saveAndStart() {
  const nameInput = document.getElementById("petNameInput")?.value?.trim();

  if (!selectedBreed) {
    alert("เลือกพันธุ์สุนัขก่อนนะ!");
    return;
  }
  if (!nameInput) {
    alert("อย่าลืมตั้งชื่อให้น้องด้วยนะ!");
    return;
  }

  try {
    await apiFetch("/pet", {
      method: "POST",
      body: JSON.stringify({ breed: selectedBreed, name: nameInput }),
    });
    // สมัครใหม่เลือก pet เสร็จ → เข้าหน้าหลักเริ่มใช้งาน (ไม่ใช่ Pet.html)
    // ตาม flow: register → login → select-pet → index (หน้าแรก)
    window.location.href = "index.html";
  } catch (err) {
    alert(err.message);
  }
}

// ================== หน้า Pet.html ==================

const BREED_EMOJI = { golden: "🦮", shiba: "🐕", siberian: "🐺", thairidgeback: "🐶" };
const BREED_LABEL = { golden: "โกลเด้น", shiba: "ชิบะ", siberian: "ไซบีเรียนฮัสกี้", thairidgeback: "ไทยหลังอาน" };
const BREED_LOGO = {
  golden: "img/game/Logo_golden.png",
  shiba: "img/game/Logo_shiba.png",
  siberian: "img/game/Logo_Siberian.png",
  thairidgeback: "img/game/Logo_thairidgeback.png",
};

// ท่าทางของแต่ละพันธุ์ (ไฟล์ไหนยังไม่มีก็ไม่ต้องใส่ ระบบจะข้ามไปใช้ idle/อิโมจิสำรองแทนเอง)
//   idle      = Jumping ตัดแค่ 2 วิแรกก่อนโดด
//   levelUp   = Jumping คลิปเต็ม ตอนเลเวลอัพ
//   bath      = Shaking
//   holdPet   = Chasing ตอนกำลังลูบหัวค้างอยู่
//   happiness = ตอนปล่อยมือหลังลูบหัวเสร็จ / กดปุ่มเล่นด้วยกัน
//   sleep     = ท่านอน
//   low       = ท่าเศร้า: ความสุขต่ำกว่า 25% หรือไม่ได้อ่านหนังสือด้วยกันหลายวัน (เหงา)
//   reading   = ท่าอ่านหนังสือ: อ่านติดกันตั้งแต่ READING_POSE_STREAK_DAYS วัน สลับกับท่า idle (ดู refreshPetMood)
//   glow      = ท่าเปล่งแสง: วันที่ streak ครบ 3/7/14/30 วัน (สลับกับท่า idle) และตอนค่าสถานะเต็มทุกช่อง (ขึ้นแป๊บเดียว)
const PET_POSES = {
  thairidgeback: {
    idle: ["img/pets/thairidgeback/thairidgeback_stand.gif"],
    feed: ["img/pets/thairidgeback/thairidgeback_eating.gif"],
    happiness: ["img/pets/thairidgeback/thairidgeback_happy.gif"],
    levelUp: ["img/pets/thairidgeback/thairidgeback_happy.gif"], // ยังไม่มีท่ากระโดด ใช้ท่าดีใจแทน
    bath: ["img/pets/thairidgeback/thairidgeback_bath.gif"],
    holdPet: ["img/pets/thairidgeback/thairidgeback_sit.gif"],
    sleep: ["img/pets/thairidgeback/thairidgeback_sleeping.gif"],
    low: ["img/pets/thairidgeback/thairidgeback_sad.gif"],
    reading: ["img/pets/thairidgeback/thairidgeback_reading.gif"],
    glow: ["img/pets/thairidgeback/thairidgeback_glow.gif"],
  },
  golden: {
    idle: ["img/pets/golden/09_golden_happy_normal_wag.gif"],
    feed: ["img/pets/golden/golden_eating.gif"],
    happiness: ["img/pets/golden/golden_happy.gif", "img/pets/golden/08_golden_happy_fast_wag.gif"],
    levelUp: ["img/pets/golden/golden_jump.gif"],
    bath: ["img/pets/golden/golden_bath.gif", "img/pets/golden/golden_bath_shaking fur.gif"],
    holdPet: ["img/pets/golden/08_golden_happy_fast_wag.gif"],
    sleep: ["img/pets/golden/golden_sleeping.gif"],
    low: ["img/pets/golden/golden_sad.gif"],
    reading: ["img/pets/golden/golden_reading.webp"],
    glow: ["img/pets/golden/golden_glow.webp"],
  },
  shiba: {
    idle: ["img/pets/shiba/shiba_stand.gif"],
    feed: ["img/pets/shiba/shiba_eating.gif"],
    happiness: ["img/pets/shiba/shiba_happy.gif"],
    levelUp: ["img/pets/shiba/shiba_happy.gif"], // ยังไม่มีท่ากระโดด ใช้ท่าดีใจแทน
    bath: ["img/pets/shiba/shiba_bath.gif"],
    holdPet: ["img/pets/shiba/shiba_tail_blink_ear_120f.gif"],
    sleep: ["img/pets/shiba/shiba_sleeping.gif"],
    low: ["img/pets/shiba/shiba_sad.gif"],
    reading: ["img/pets/shiba/shiba_reading.webp"],
    glow: ["img/pets/shiba/shiba_glow.webp"],
  },
  siberian: {
    idle: ["img/pets/siberian/husky_sit_tail_tongue_blink.gif"],
    feed: ["img/pets/siberian/husky_eating_tail.gif"],
    happiness: ["img/pets/siberian/husky_happy_wag_blink.gif"],
    levelUp: ["img/pets/siberian/husky_howling.gif"],
    bath: ["img/pets/siberian/husky_bath.gif"],
    holdPet: ["img/pets/siberian/husky_tail_blink_ear.gif"],
    sleep: ["img/pets/siberian/husky_puppy_sleeping_zzz.gif", "img/pets/siberian/husky_adult_sleeping_zzz.gif"],
    low: ["img/pets/siberian/husky_sad.gif"],
    reading: ["img/pets/siberian/husky_reading.webp"],
    glow: ["img/pets/siberian/husky_glow.webp"],
  },
};

// ตัว Zzz ลอยขึ้นจากหัว สำหรับรูปท่านอนที่เป็นภาพนิ่ง (GIF ของพันธุ์อื่นมี zzz ในตัวอยู่แล้ว)
// x, y = ตำแหน่งหัวน้องเป็นสัดส่วนของรูปต้นฉบับ (รูปถูกย่อแบบ contain ชิดขอบล่างในกล่อง #petImg)
// (ตอนนี้ทุกพันธุ์มี zzz ในรูปท่านอนแล้ว ถ้าเพิ่มรูปท่านอนที่ไม่มี zzz ให้ใส่ตำแหน่งหัวไว้ที่นี่)
const SLEEP_ZZZ_ANCHOR = {};

function updateSleepZzz(petImg, src) {
  const character = document.getElementById("petCharacter");
  character?.querySelector(".pet-zzz")?.remove();
  const anchor = SLEEP_ZZZ_ANCHOR[src];
  if (!anchor || !character || !petImg.naturalWidth) return;

  // หาตำแหน่งจริงของรูปในกล่อง (object-fit: contain + object-position: center bottom)
  const scale = Math.min(petImg.clientWidth / petImg.naturalWidth, petImg.clientHeight / petImg.naturalHeight);
  const drawnW = petImg.naturalWidth * scale;
  const drawnH = petImg.naturalHeight * scale;
  const left = petImg.offsetLeft + (petImg.clientWidth - drawnW) / 2 + anchor.x * drawnW;
  const top = petImg.offsetTop + (petImg.clientHeight - drawnH) + anchor.y * drawnH;

  const zzz = document.createElement("div");
  zzz.className = "pet-zzz";
  zzz.setAttribute("aria-hidden", "true");
  zzz.style.left = `${left}px`;
  zzz.style.top = `${top}px`;
  zzz.innerHTML = "<span>z</span><span>z</span><span>Z</span>";
  character.appendChild(zzz);
}

function getPoseFrames(breed, poseKey) {
  return PET_POSES[breed]?.[poseKey] || null;
}

function renderPetPage(pet) {
  const petNameDisplay = document.getElementById("petName");
  if (petNameDisplay) petNameDisplay.innerText = pet.name;
  const myDogsIcon = document.getElementById("myDogsIcon");
  if (myDogsIcon && BREED_LOGO[pet.breed]) myDogsIcon.src = BREED_LOGO[pet.breed];

  setPetImage(pet.breed);
  updatePetUI(pet);
  applyEquippedOverlays(); // วางเสื้อผ้าที่ user เคยใส่ไว้ (persist ใน localStorage)
  renderStreak();
  refreshPetMood();
  showSpeech(moodSpeech(currentStreak), 4500);
  if (allStatsFull(pet)) showPetPose("glow", 4000);
}

// ================== น้องหมาของฉัน: ดูทุกตัว + สลับตัวที่เลี้ยง ==================
// ตัวที่เลี้ยงอยู่มีตัวเดียว ตัวอื่นพักอยู่ในบ้าน (ค่าไม่ลด) — GET /pet/all, POST /pet/switch

let myDogs = { active: null, others: [] };

async function loadMyDogs() {
  myDogs = await apiFetch("/pet/all");
  const count = document.getElementById("myDogsCount");
  if (count) {
    count.textContent = String(myDogs.others.length + 1);
    count.hidden = myDogs.others.length === 0;
  }
  renderMyDogs();
}

function myDogRow(dog, isActive) {
  const logo = BREED_LOGO[dog.breed];
  const pic = logo
    ? `<img src="${logo}" alt="" class="my-dog-pic">`
    : `<span class="my-dog-pic my-dog-emoji">${BREED_EMOJI[dog.breed] || "🐶"}</span>`;
  const action = isActive
    ? `<span class="my-dog-current">กำลังเลี้ยงอยู่</span>`
    : `<button type="button" class="my-dog-pick" onclick="switchDog(${Number(dog.id)}, this)">เลือกตัวนี้</button>`;
  return `<li class="${isActive ? "is-active" : ""}">
      ${pic}
      <div class="my-dog-info">
        <strong>${escapeHtml(dog.name)}</strong>
        <span>${escapeHtml(BREED_LABEL[dog.breed] || dog.breed)} · เลเวล ${Number(dog.level) || 1}</span>
      </div>
      ${action}
    </li>`;
}

function renderMyDogs() {
  const list = document.getElementById("myDogsList");
  if (!list || !myDogs.active) return;
  list.innerHTML = [myDogRow(myDogs.active, true), ...myDogs.others.map((d) => myDogRow(d, false))].join("");
}

async function openMyDogs() {
  toggleModal("myDogsModal", true);
  try {
    await loadMyDogs();
  } catch (err) {
    console.error("โหลดน้องหมาของฉันไม่สำเร็จ:", err);
  }
}

async function switchDog(stableId, btn) {
  if (btn) btn.disabled = true;
  try {
    const result = await apiFetch("/pet/switch", {
      method: "POST",
      body: JSON.stringify({ stableId }),
    });
    currentPet = result.pet;
    currentStreak = result.streak || currentStreak;
    myDogs = { active: result.pet, others: result.others || [] };
    renderMyDogs();
    renderPetPage(currentPet);
    toggleModal("myDogsModal", false);
    showSpeech(`สวัสดีครับเจ้านาย ${currentPet.name} มาแล้ว!`, 3500);
  } catch (err) {
    alert("❌ " + err.message);
    if (btn) btn.disabled = false;
  }
}

// ================== ความต่อเนื่องในการอ่าน (streak) → อารมณ์น้องหมา ==================
// server คำนวณจากรอบอ่านที่จบแล้ว: happy (อ่านวันนี้แล้ว) | waiting (วันนี้ยังไม่ได้อ่าน) | lonely (ไม่ได้อ่าน 2-3 วัน)
// | very_lonely (4 วันขึ้นไป) | new (ยังไม่เคยอ่าน) — ตอนเหงาน้องจะทำท่าเศร้า และลูบหัว/ของเล่นช่วยได้ไม่เกินครึ่ง

let currentStreak = null;

function streakText(streak) {
  if (!streak) return "";
  switch (streak.mood) {
    case "happy":
      return `🔥 อ่านติดกัน ${streak.current} วัน · วันนี้อ่านด้วยกันแล้ว`;
    case "waiting":
      return `🔥 อ่านติดกัน ${streak.current} วัน · วันนี้ยังไม่ได้อ่าน น้องรออยู่นะ`;
    case "lonely":
    case "very_lonely":
      return `💤 ไม่ได้อ่านด้วยกันมา ${streak.daysSinceRead} วันแล้ว น้องเหงา`;
    default:
      return "📖 ยังไม่เคยอ่านหนังสือด้วยกันเลย ไปอ่านบทแรกกัน!";
  }
}

function moodSpeech(streak) {
  if (!streak) return "เจ้านาย มาเล่นด้วยกันเถอะ";
  switch (streak.mood) {
    case "happy":
      if (STREAK_MILESTONES.includes(streak.current)) {
        return `🔥 อ่านติดกันครบ ${streak.current} วันแล้ว! เก่งมากเลยเจ้านาย ✨`;
      }
      return streak.current >= READING_POSE_STREAK_DAYS
        ? `อ่านด้วยกันติดกัน ${streak.current} วันแล้ว ผมขยันอ่านตามเจ้านายเลย 🤓📖`
        : "วันนี้อ่านหนังสือด้วยกันแล้ว ดีใจที่สุดเลย! 🐾";
    case "waiting":
      return "วันนี้ไปอ่านหนังสือด้วยกันไหมเจ้านาย? 📖";
    case "lonely":
      return `เหงาจัง... ไม่ได้อ่านหนังสือด้วยกันมา ${streak.daysSinceRead} วันแล้ว 🥺`;
    case "very_lonely":
      return "เจ้านายหายไปไหนมา... คิดถึงมากเลย 😢 กลับมาอ่านหนังสือด้วยกันนะ";
    default:
      return "เจ้านาย มาอ่านหนังสือด้วยกันเถอะ! 📖";
  }
}

function renderStreak() {
  const el = document.getElementById("petStreak");
  if (!el) return;
  el.textContent = streakText(currentStreak);
  el.dataset.mood = currentStreak ? currentStreak.mood : "";
}

// โชว์ข้อความในบับเบิลแค่ชั่วครู่แล้วหายไปเอง (ไม่ค้างจอทั้งวัน)
let speechHideTimer = null;

function showSpeech(text, durationMs = 2200) {
  const speech = document.getElementById("petSpeech");
  if (!speech || !text) return;

  speech.innerText = text;
  speech.classList.add("show");

  clearTimeout(speechHideTimer);
  speechHideTimer = setTimeout(() => {
    speech.classList.remove("show");
  }, durationMs);
}

// แสดงรูป idle เริ่มต้นของพันธุ์นั้น (img/{breed}-idle.gif) ถ้าไม่มีไฟล์จะ fallback เป็นอิโมจิ
function setPetImage(breed) {
  applyPetImageSrc(`img/${breed}-idle.gif`, breed);
}

function applyPetImageSrc(src, breed) {
  const petImg = document.getElementById("petImg");
  const petEmoji = document.getElementById("petEmoji");
  if (!petImg) return;

  petImg.onload = () => {
    petImg.style.display = "block";
    if (petEmoji) petEmoji.style.display = "none";
    updateSleepZzz(petImg, src);
  };
  petImg.onerror = () => {
    updateSleepZzz(petImg, null);
    petImg.style.display = "none";
    if (petEmoji) {
      petEmoji.textContent = BREED_EMOJI[breed] || "🐶";
      petEmoji.style.display = "block";
    }
  };
  petImg.src = src;
}

// ================== สลับท่าทางตามกิจกรรม/สถานะ (ใช้ไฟล์จริงถ้ามี ไม่มีก็เงียบๆ ไม่ทำอะไร) ==================

let poseRevertTimer = null;
let showingTemporaryPose = false;

// โชว์ท่าเฉพาะกิจกรรมชั่วคราว (เช่นตอนกินข้าว/เล่นด้วยกัน) แล้วกลับไปท่าปกติ/ท่าเศร้าอัตโนมัติหลังจากนั้น
function showPetPose(poseKey, revertAfterMs) {
  if (!currentPet) return;
  if (poseKey !== "sleep") stopSleepSound(); // ปลุกน้องด้วยกิจกรรมอื่น = หยุดกล่องดนตรี
  const frames = getPoseFrames(currentPet.breed, poseKey);
  if (!frames || !frames.length) return; // ยังไม่มีไฟล์ท่านี้ ปล่อยรูปเดิมไว้ตามเดิม

  const src = frames[Math.floor(Math.random() * frames.length)];
  applyPetImageSrc(src, currentPet.breed);

  clearTimeout(poseRevertTimer);
  if (revertAfterMs) {
    showingTemporaryPose = true;
    poseRevertTimer = setTimeout(() => {
      showingTemporaryPose = false;
      refreshPetMood();
    }, revertAfterMs);
  }
}

// ข้อ 7 — น้องสะท้อนการอ่านของผู้ใช้:
// อ่านติดกันตั้งแต่ 3 วัน สลับท่าอ่านหนังสือกับท่ายืนปกติ | วันที่ streak ครบ 3/7/14/30 วัน เพิ่มท่าเปล่งแสงเข้าไปในวงสลับด้วย
// ลำดับวน: ท่าพิเศษ → idle → ท่าพิเศษถัดไป → idle ...
const READING_POSE_STREAK_DAYS = 3;
const STREAK_MILESTONES = [3, 7, 14, 30];
const SPECIAL_POSE_MS = 12000;
const IDLE_POSE_MS = 8000;
let poseCycleStep = 0;
let poseCycleTimer = null;

function readingStreakActive() {
  return !!(currentStreak && !currentStreak.lonely && currentStreak.current >= READING_POSE_STREAK_DAYS);
}

function streakMilestoneToday() {
  return readingStreakActive() && STREAK_MILESTONES.includes(currentStreak.current);
}

// ท่าพิเศษที่วนโชว์ตอนนี้ (เฉพาะท่าที่พันธุ์นั้นมีรูป)
function specialPoseCycle() {
  if (!currentPet || !readingStreakActive()) return [];
  const keys = streakMilestoneToday() ? ["glow", "reading"] : ["reading"];
  return keys.filter((k) => getPoseFrames(currentPet.breed, k));
}

// คืน key ของท่าพิเศษในจังหวะนี้ หรือ null = จังหวะท่า idle
function currentCyclePose() {
  const special = specialPoseCycle();
  if (!special.length || poseCycleStep % 2 === 1) return null;
  return special[(poseCycleStep / 2) % special.length];
}

function schedulePoseCycle() {
  clearTimeout(poseCycleTimer);
  if (!specialPoseCycle().length) return;
  poseCycleTimer = setTimeout(() => {
    poseCycleStep += 1;
    refreshPetMood();
  }, currentCyclePose() ? SPECIAL_POSE_MS : IDLE_POSE_MS);
}

function allStatsFull(pet) {
  return !!pet && ["hunger", "cleanliness", "happiness", "energy"].every((k) => (pet[k] ?? 0) >= 100);
}

// หลังดูแลน้องจนค่าสถานะเต็มทุกช่อง: ท่าเปล่งแสงแป๊บนึง แทนท่ากิจกรรม
function celebrateIfAllFull(before, after) {
  if (!allStatsFull(after) || allStatsFull(before) || !getPoseFrames(after.breed, "glow")) return false;
  showPetPose("glow", 4000);
  showSpeech("ทุกอย่างเต็มหมดเลย สบายที่สุด ขอบคุณนะเจ้านาย ✨", 3500);
  return true;
}

// เช็คว่ามีสถานะไหนต่ำกว่าเกณฑ์ไหม ถ้ามีโชว์ท่าเศร้าค้างไว้ อ่านติดกันหลายวันสลับท่าอ่านหนังสือ ไม่งั้นท่า idle ปกติ
// (ไม่ทำอะไรถ้ากำลังโชว์ท่ากิจกรรมชั่วคราวอยู่ กันแย่งกันโชว์)
function refreshPetMood() {
  schedulePoseCycle();
  if (!currentPet || showingTemporaryPose) return;

  // ท่าเศร้า (low) โชว์ตอน "ความสุข" ต่ำกว่าเกณฑ์ หรือไม่ได้อ่านหนังสือด้วยกันหลายวัน (เหงา)
  const happinessLow = (currentPet.happiness ?? 100) < STAT_LOW_THRESHOLD;
  const lonely = !!(currentStreak && currentStreak.lonely);
  if (happinessLow || lonely) {
    const lowFrames = getPoseFrames(currentPet.breed, "low");
    if (lowFrames && lowFrames.length) {
      applyPetImageSrc(lowFrames[0], currentPet.breed);
      return;
    }
  }

  const cyclePose = currentCyclePose();
  if (cyclePose) {
    applyPetImageSrc(getPoseFrames(currentPet.breed, cyclePose)[0], currentPet.breed);
    return;
  }

  const idleFrames = getPoseFrames(currentPet.breed, "idle");
  if (idleFrames && idleFrames.length) {
    applyPetImageSrc(idleFrames[0], currentPet.breed);
  } else {
    setPetImage(currentPet.breed);
  }
}

// ต้องตรงกับ MAX_LEVEL ฝั่ง BACKEND/src/routes/pet.js
const MAX_LEVEL = 50;

const STAT_LOW_THRESHOLD = 25;

const STAT_FIELDS = [
  { key: "hunger", fillId: "statFillHunger", percentId: "statPercentHunger", warnId: "statWarnHunger" },
  { key: "cleanliness", fillId: "statFillCleanliness", percentId: "statPercentCleanliness", warnId: "statWarnCleanliness" },
  { key: "happiness", fillId: "statFillHappiness", percentId: "statPercentHappiness", warnId: "statWarnHappiness" },
  { key: "energy", fillId: "statFillEnergy", percentId: "statPercentEnergy", warnId: "statWarnEnergy" },
];

function updatePetUI(pet) {
  STAT_FIELDS.forEach(({ key, fillId, percentId, warnId }) => {
    const value = pet[key] ?? 100;
    const isLow = value < STAT_LOW_THRESHOLD;

    const fill = document.getElementById(fillId);
    if (fill) {
      fill.style.height = value + "%";
      fill.classList.toggle("low", isLow);
    }

    const percentEl = document.getElementById(percentId);
    if (percentEl) percentEl.textContent = value + "%";

    const warnEl = document.getElementById(warnId);
    if (warnEl) warnEl.classList.toggle("show", isLow);
  });

  const levelEl = document.getElementById("petLevel");
  if (levelEl) levelEl.textContent = pet.level ?? 0;

  // แถบนี้โชว์ความคืบหน้า "ภายในเลเวลปัจจุบัน" (ไม่ใช่ภาพรวมถึงเลเวล 50) เลยขยับทีละนิดตามเปอร์เซ็นต์ของไอเทมที่ให้แต่ละครั้ง
  const growthFill = document.getElementById("growthFill");
  if (growthFill) {
    const target = pet.levelXpTarget || 1;
    const progress = pet.level >= MAX_LEVEL ? 100 : Math.min(100, ((pet.levelProgress ?? 0) / target) * 100);
    growthFill.style.width = Math.max(0, progress) + "%";
  }

  refreshPetMood();
}

// ================== ระบบกระเป๋าไอเทม ==================
// ไอเทมมาจากของที่ผู้ใช้ซื้อจริงในร้านค้า (ตาราง inventory ฝั่ง backend) ไม่ได้ hardcode ไว้แล้ว
// ไอเทมจะอยู่กระเป๋าไหน และใช้แล้วเติมสถานะกี่ % มาจากค่า pet_action / stat_gain ที่แอดมินตั้งไว้ในหน้าจัดการร้านค้า
// ตอนกด "ใช้" จะยิง /pet/use-item ซึ่งหักของออกจากคลังจริงและคิดค่าสถานะจากฐานข้อมูลล้วนๆ (client ส่งตัวเลขมาโกงไม่ได้)

const bags = {
  feed: { key: "feed", title: "กระเป๋าอาหาร", tag: "🍽️" },
  bath: { key: "bath", title: "กระเป๋าอาบน้ำ", tag: "🛁" },
  happiness: { key: "happiness", title: "กระเป๋าของเล่น", tag: "😊" },
  sleep: { key: "sleep", title: "กระเป๋าอุปกรณ์นอน", tag: "😴" },
  // เพิ่ม 'clothing' เป็นกระเป๋าพิเศษ กรองจาก category === "เสื้อผ้า" ไม่ใช่ pet_action
  // ใช้สำหรับปุ่มกระเป๋าเสื้อผ้าที่แยกออกมาบนหน้า Pet.html
  clothing: { key: "clothing", title: "กระเป๋าเสื้อผ้า", tag: "👗" },
};

// ไอคอนสำรองต่อกระเป๋า ใช้เมื่อไอเทมนั้นโหลดรูปจากร้านไม่ขึ้น
const BAG_FALLBACK_ICON = { feed: "🍖", bath: "🧼", happiness: "🎾", sleep: "🛏️", clothing: "👕" };

const speeches = {
  feed: "ง่ำๆ อร่อยจังเลยเจ้านาย!",
  bath: "ตัวผมหอมฟุ้ง สดชื่นสุดๆ!",
  happiness: "เย้! สนุกจัง รักเจ้านายที่สุด!",
  sleep: "ง่วงแล้วสิ... ฝันดีนะเจ้านาย 💤",
};

let currentBagKey = null;
let inventoryItems = []; // ของที่ซื้อไว้จริงทั้งหมด โหลดจาก /shop/inventory

// URL รากของ backend ใช้ต่อ path รูปสินค้าที่แอดมินอัปโหลดไว้ (เหมือนที่ shop.js ทำ)
const UPLOADS_BASE_URL = API_BASE_URL.replace(/\/api\/?$/, "");

function resolveItemImg(img) {
  if (!img) return null;
  if (img.startsWith("http")) return img;
  if (img.startsWith("/")) return `${UPLOADS_BASE_URL}${img}`;
  return `img/${img}`;
}

async function loadInventory() {
  try {
    const { inventory } = await apiFetch("/shop/inventory");
    inventoryItems = inventory;
  } catch (err) {
    console.error("โหลดกระเป๋าไอเทมไม่สำเร็จ:", err);
    inventoryItems = [];
  }
}

function getBagItems(bagKey) {
  // กระเป๋าเสื้อผ้ากรองด้วย category ไม่ใช่ pet_action
  // (เสื้อผ้าบางชิ้นมี pet_action="happiness" อยู่แล้ว จะได้ไม่หายเข้ากระเป๋าของเล่น)
  if (bagKey === "clothing") {
    return inventoryItems.filter((item) => item.category === "เสื้อผ้า" && item.count > 0);
  }
  return inventoryItems.filter((item) => item.pet_action === bagKey && item.count > 0);
}

function renderInventoryGrid(bagKey) {
  const grid = document.getElementById("inventoryGrid");
  if (!grid) return;

  const items = getBagItems(bagKey);
  grid.innerHTML = "";

  if (!items.length) {
    grid.innerHTML =
      '<div class="empty-note">ยังไม่มีไอเทมในกระเป๋านี้<br>ไปซื้อที่<a href="Shop.html">ร้านค้า</a>ก่อนนะ 🛍️</div>';
    return;
  }

  const isClothing = bagKey === "clothing";
  items.forEach((item) => {
    const imgSrc = resolveItemImg(item.img);
    const safeName = escapeHtml(item.name);
    const equipped = isClothing && isItemEquipped(item.id);
    const card = document.createElement("div");
    card.className = "item-card" + (equipped ? " equipped" : "");
    // ปุ่ม "ใส่" / "ถอด" สลับตาม state; stat_gain ไม่แสดงในกระเป๋าเสื้อผ้าเพราะเสื้อผ้าไม่เติมสถานะแล้ว
    const buttonLabel = isClothing ? (equipped ? "ถอด" : "ใส่") : "ใช้";
    card.innerHTML = `
      <span class="qty">x${item.count}</span>
      <div class="icon">${
        imgSrc
          ? `<img src="${escapeHtml(imgSrc)}" alt="${safeName}" onerror="this.replaceWith(document.createTextNode('${BAG_FALLBACK_ICON[bagKey]}'))">`
          : BAG_FALLBACK_ICON[bagKey]
      }</div>
      <div class="name">${safeName}</div>
      ${isClothing ? "" : `<div class="stat-gain">+${item.stat_gain}%</div>`}
      <button class="use-btn ${equipped ? "unwear" : ""}">${buttonLabel}</button>
    `;
    const btn = card.querySelector(".use-btn");
    if (isClothing) {
      if (equipped) {
        btn.addEventListener("click", () => unwearClothing(item.id));
      } else {
        btn.addEventListener("click", () => wearClothing(item, card));
      }
    } else {
      btn.addEventListener("click", () => useItem(item.id));
    }
    grid.appendChild(card);
  });
}

function openBag(bagKey) {
  currentBagKey = bagKey;
  const bag = bags[bagKey];

  // หัวข้อบนกล่องกระเป๋าเปลี่ยนตามโหมดที่กดเข้ามา (ไม่ใช้แท็บสลับโหมดในกล่องแล้ว)
  const modeTitleEl = document.getElementById("inventoryModeTitle");
  if (modeTitleEl) modeTitleEl.textContent = `${bag.tag} ${bag.title}`;

  renderInventoryGrid(bagKey);
  setInventoryVisible(true);
}

function setInventoryVisible(show) {
  const overlay = document.getElementById("inventoryOverlay");
  const drawer = document.getElementById("inventoryDrawer");

  if (overlay) {
    overlay.classList.toggle("show", show);
    overlay.style.display = show ? "flex" : "none";
  }
  if (drawer) drawer.classList.toggle("show", show);

  if (!show) currentBagKey = null;
}

function toggleInventory(show) {
  if (show) {
    openBag(currentBagKey || "feed");
  } else {
    setInventoryVisible(false);
  }
}

function bounceCharacter() {
  const character = document.querySelector(".pet-character");
  if (!character) return;
  character.classList.remove("bounce");
  void character.offsetWidth;
  character.classList.add("bounce");
}

function showFloater(text, isHeart) {
  const wrap = document.getElementById("petFloaters");
  if (!wrap) return;
  const f = document.createElement("div");
  f.className = "pet-floater" + (isHeart ? " heart" : "");
  f.textContent = text;
  wrap.appendChild(f);
  setTimeout(() => f.remove(), 1100);
}

// ---- ระบบเสื้อผ้าที่ใส่อยู่ (persist per user ใน localStorage) ----
// เก็บแบบ 2 slot: hat (บนหัว) + body (ลำตัว) — ต่อ 1 slot ได้ 1 ชิ้น
// ไม่หัก inventory เวลาใส่ (เพราะไม่ใช่ของกิน) แค่ user ต้องมี count >= 1 ถึงจะใส่ได้
function getEquipStorageKey() {
  const username = localStorage.getItem("currentUser") || "guest";
  return `petEquip_${username}`;
}

function loadEquipped() {
  try {
    return JSON.parse(localStorage.getItem(getEquipStorageKey()) || "{}");
  } catch {
    return {};
  }
}

function saveEquipped(equipped) {
  localStorage.setItem(getEquipStorageKey(), JSON.stringify(equipped));
}

// เดา slot ของไอเทมจากชื่อ (หมวก → hat, ที่เหลือในหมวดเสื้อผ้า → body)
function detectSlot(item) {
  const name = (item.name || "").toLowerCase();
  if (name.includes("หมวก") || name.includes("hat") || name.includes("cap")) return "hat";
  return "body";
}

// อ่าน equipped จาก storage แล้ววาง src ให้ img overlay บนตัวน้อง
function applyEquippedOverlays() {
  const equipped = loadEquipped();
  const hatEl = document.getElementById("equipHat");
  const bodyEl = document.getElementById("equipBody");
  ["hat", "body"].forEach((slot) => {
    const el = slot === "hat" ? hatEl : bodyEl;
    if (!el) return;
    const item = equipped[slot];
    if (item && item.img) {
      el.src = resolveItemImg(item.img);
      el.style.display = "";
      el.alt = item.name;
    } else {
      el.style.display = "none";
      el.removeAttribute("src");
    }
  });
}

// ปุ่ม "ใส่" ในกระเป๋าเสื้อผ้า:
// 1) บิน sprite ของเสื้อจากการ์ดไปหาน้อง (fly animation ~700ms)
// 2) น้องเด้ง + sparkle รอบตัว
// 3) วางรูปทับบนตัวน้องเลย + save localStorage (ไม่หัก inventory)
async function wearClothing(item, cardEl) {
  if (!item || item.count <= 0) return;

  const slot = detectSlot(item);
  const iconEl = cardEl.querySelector(".icon img") || cardEl.querySelector(".icon");
  const petEl = document.querySelector(".pet-character");
  if (iconEl && petEl) {
    const from = iconEl.getBoundingClientRect();
    const to = petEl.getBoundingClientRect();

    const flyer = iconEl.cloneNode(true);
    flyer.className = "clothing-flyer";
    flyer.style.left = from.left + from.width / 2 + "px";
    flyer.style.top = from.top + from.height / 2 + "px";
    flyer.style.width = from.width + "px";
    flyer.style.height = from.height + "px";
    document.body.appendChild(flyer);

    void flyer.offsetWidth;
    flyer.style.left = to.left + to.width / 2 + "px";
    flyer.style.top = to.top + to.height / 2 + "px";
    flyer.style.transform = "translate(-50%, -50%) scale(0.5) rotate(360deg)";
    flyer.style.opacity = "0";

    setTimeout(() => {
      bounceCharacter();
      spawnSparkles(to.left + to.width / 2, to.top + to.height / 2);
      showFloater("✨");
      // วางรูปจริงบนน้องตอน flyer มาถึง (พร้อมกับ bounce → รู้สึกเหมือน "ติด" ตัวจริง)
      const equipped = loadEquipped();
      equipped[slot] = { id: item.id, name: item.name, img: item.img };
      saveEquipped(equipped);
      applyEquippedOverlays();
    }, 600);

    setTimeout(() => flyer.remove(), 900);
  } else {
    // fallback ถ้าหา DOM ไม่เจอ (edge case) — ใส่เลยไม่มี animation
    const equipped = loadEquipped();
    equipped[slot] = { id: item.id, name: item.name, img: item.img };
    saveEquipped(equipped);
    applyEquippedOverlays();
  }

  showSpeech(`ผมใส่${item.name}แล้วครับ เท่ไหม?`);
  renderInventoryGrid("clothing"); // re-render เพื่อสลับปุ่ม "ใส่" → "ถอด"
}

// ปุ่ม "ถอด" ในกระเป๋าเสื้อผ้า — ลบ overlay + clear localStorage ของ slot นั้น
function unwearClothing(itemId) {
  const equipped = loadEquipped();
  ["hat", "body"].forEach((slot) => {
    if (equipped[slot] && equipped[slot].id === itemId) delete equipped[slot];
  });
  saveEquipped(equipped);
  applyEquippedOverlays();
  showSpeech("ถอดออกแล้วครับ 🐶");
  renderInventoryGrid("clothing");
}

// เช็คว่า itemId นี้กำลังใส่อยู่ (ใช้ตอน render ปุ่ม)
function isItemEquipped(itemId) {
  const equipped = loadEquipped();
  return ["hat", "body"].some((slot) => equipped[slot] && equipped[slot].id === itemId);
}

// สร้าง sparkle 6 อันวางเป็นวงรอบจุด (x, y) ค่อยๆ ลอยออกแล้วจางหายภายใน ~800ms
function spawnSparkles(x, y) {
  const symbols = ["✨", "⭐", "💫", "✨", "⭐", "💖"];
  symbols.forEach((sym, i) => {
    const s = document.createElement("div");
    s.className = "clothing-sparkle";
    s.textContent = sym;
    s.style.left = x + "px";
    s.style.top = y + "px";
    const angle = (i / symbols.length) * Math.PI * 2;
    const dist = 60 + Math.random() * 30;
    s.style.setProperty("--dx", Math.cos(angle) * dist + "px");
    s.style.setProperty("--dy", Math.sin(angle) * dist + "px");
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 900);
  });
}

async function useItem(productId) {
  const bagKey = currentBagKey;
  const item = inventoryItems.find((i) => i.id === productId);
  if (!item || item.count <= 0) return;

  try {
    const result = await apiFetch("/pet/use-item", {
      method: "POST",
      body: JSON.stringify({ productId }),
    });

    // จำนวนคงเหลือเชื่อจากฝั่ง server เสมอ (เผื่อเปิดหลายแท็บแล้วใช้ของสวนกัน)
    item.count = result.remainingCount;

    showSpeech(speeches[bagKey]);
    const petBefore = currentPet;
    currentPet = { ...currentPet, ...result.pet };
    updatePetUI(currentPet);
    bounceCharacter();
    showFloater("+" + result.amountGained);
    renderInventoryGrid(bagKey);

    if (result.leveledUp) {
      showPetPose("levelUp", 4000); // ท่าฉลองเลเวลอัพ สำคัญกว่าท่ากิจกรรมปกติ เลยแสดงแทน
      showLevelUpCelebration(result);
    } else if (bagKey === "feed") {
      EAT_SOUND.currentTime = 0;
      EAT_SOUND.play().catch(() => {});
      if (!celebrateIfAllFull(petBefore, currentPet)) showPetPose("feed", 3000);
    } else if (bagKey === "sleep") {
      // ใช้ไอเทมนอน: เปิดกล่องดนตรีแล้วให้น้องนอนจนเพลงจบ (ถ้าสถานะเต็มทุกช่องก็ยังเปล่งแสงแป๊บนึงก่อน)
      if (!celebrateIfAllFull(petBefore, currentPet)) showPetPose("sleep", SLEEP_POSE_MS);
      playSleepSound();
    } else if (!celebrateIfAllFull(petBefore, currentPet)) {
      showPetPose(bagKey, 3000); // โชว์ท่ากิจกรรมชั่วคราว 3 วิ ถ้ามีไฟล์ท่านั้น (ไม่มีก็เงียบๆ ไม่ทำอะไร)
    }
  } catch (err) {
    console.error("Use item error:", err);
    alert(err.message);
    // ใช้ไม่สำเร็จเพราะของหมด/สถานะเต็ม — ดึงคลังใหม่ให้ตรงกับความจริงฝั่ง server
    await loadInventory();
    renderInventoryGrid(bagKey);
  }
}

// ================== กดค้างที่ตัวน้องเพื่อลูบหัว (เพิ่มความสุขสด ไม่ต้องเปิดกระเป๋า) ==================
// นับจำนวนครั้งที่ลูบระหว่างกดค้างไว้ฝั่ง client แล้วค่อยส่งยอดรวมไปครั้งเดียวตอนปล่อยนิ้ว/เมาส์
// (เบากว่าการยิง API ทุก tick และฝั่งเซิร์ฟเวอร์ก็จำกัดจำนวนครั้งสูงสุดต่อ request ไว้อยู่แล้วกันโกง)

let pettingInterval = null;
let pettingCount = 0;

function setupPetting() {
  const character = document.getElementById("petCharacter");
  if (!character) return;

  const startPetting = (e) => {
    e.preventDefault();
    if (pettingInterval) return; // กำลังลูบอยู่แล้ว กันเริ่มซ้ำ
    pettingCount = 0;
    character.classList.add("petting");
    showPetPose("holdPet"); // ท่าตอนกำลังลูบหัวค้างอยู่ (Chasing) ถ้ามีไฟล์ — ไม่ตั้งเวลา revert เพราะ stopPetting จะเปลี่ยนเป็นท่า happiness ให้เองตอนปล่อยมือ
    pettingInterval = setInterval(() => {
      pettingCount += 1;
      showFloater("💕", true);
    }, 300);
  };

  const stopPetting = async () => {
    if (!pettingInterval) return;
    clearInterval(pettingInterval);
    pettingInterval = null;
    character.classList.remove("petting");

    if (pettingCount <= 0) return;
    const count = pettingCount;
    pettingCount = 0;

    try {
      const result = await apiFetch("/pet/action", {
        method: "POST",
        body: JSON.stringify({ type: "happiness", petCount: count }),
      });
      const petBefore = currentPet;
      currentPet = { ...currentPet, ...result.pet };
      updatePetUI(currentPet);
      // เหงาอยู่ (ไม่ได้อ่านหลายวัน) ลูบหัวเติมความสุขได้ไม่เกินครึ่ง — น้องบอกให้ไปอ่านหนังสือด้วยกัน
      showSpeech(result.lonelyCapped ? result.message : speeches.happiness, result.lonelyCapped ? 4500 : 2200);

      if (result.leveledUp) {
        showPetPose("levelUp", 4000); // ท่าฉลองเลเวลอัพ สำคัญกว่าท่า happiness ปกติ เลยแสดงแทน
        showLevelUpCelebration(result);
      } else if (!celebrateIfAllFull(petBefore, currentPet)) {
        showPetPose("happiness", 3000);
      }
    } catch (err) {
      console.error("ลูบหัวไม่สำเร็จ:", err);
    }
  };

  character.addEventListener("pointerdown", startPetting);
  character.addEventListener("pointerup", stopPetting);
  character.addEventListener("pointerleave", stopPetting);
  character.addEventListener("pointercancel", stopPetting);
}

// ================== ฉลองเลเวลอัพ + โบนัสถาม AI (ป้ายใหญ่ + พลุ + ท่าดีใจของน้องหมาเรา) ==================

// เสียงตอนเลเวลอัพ (ตัดเหลือ ~1.8 วิ) — ปลดล็อกตอนแตะหน้าเว็บครั้งแรก เพราะ Safari/มือถือ
// ไม่ให้เล่นเสียงที่เริ่มหลังรอผลจาก server (หลุดจากจังหวะที่ผู้ใช้กด)
const LEVEL_UP_SOUND = new Audio("sound/level-up.m4a");
LEVEL_UP_SOUND.preload = "auto";
LEVEL_UP_SOUND.volume = 0.8;

// กล่องดนตรีตอนใช้ไอเทมนอน (ตัดเหลือ 8 วิ ค่อย ๆ เบาลงตอนท้าย) — น้องหมานอนนานเท่าเพลง
const SLEEP_SOUND = new Audio("sound/pet-sleep.m4a");
SLEEP_SOUND.preload = "auto";
SLEEP_SOUND.volume = 0.6;
const SLEEP_POSE_MS = 8000;
// เสียงกินตอนใช้ไอเทมอาหาร
const EAT_SOUND = new Audio("sound/pet-eat.m4a");
EAT_SOUND.preload = "auto";
EAT_SOUND.volume = 0.8;

function primePetSound(audio) {
  audio.muted = true;
  audio
    .play()
    .then(() => {
      audio.pause();
      audio.currentTime = 0;
      audio.muted = false;
    })
    .catch(() => {
      audio.muted = false;
    });
}

function unlockLevelUpSound() {
  document.removeEventListener("pointerdown", unlockLevelUpSound, true);
  primePetSound(LEVEL_UP_SOUND);
  primePetSound(SLEEP_SOUND);
  primePetSound(EAT_SOUND);
}
document.addEventListener("pointerdown", unlockLevelUpSound, true);

function playSleepSound() {
  try {
    SLEEP_SOUND.currentTime = 0;
    SLEEP_SOUND.play().catch(() => {});
  } catch (_) {}
}

function stopSleepSound() {
  if (!SLEEP_SOUND.paused) SLEEP_SOUND.pause();
}

function playLevelUpSound() {
  try {
    LEVEL_UP_SOUND.muted = false;
    LEVEL_UP_SOUND.currentTime = 0;
    LEVEL_UP_SOUND.play().catch(() => {});
  } catch (_) {}
}

function showLevelUpCelebration(result) {
  document.querySelector(".levelup-overlay")?.remove();
  playLevelUpSound();
  const pet = result.pet || currentPet;
  const frames = getPoseFrames(pet.breed, "levelUp") || getPoseFrames(pet.breed, "happiness") || getPoseFrames(pet.breed, "idle");
  const dogHtml = frames
    ? `<img class="levelup-dog" src="${frames[0]}" alt="">`
    : `<div class="levelup-dog levelup-dog-emoji">${BREED_EMOJI[pet.breed] || "🐶"}</div>`;
  const bonus = result.aiBonusGained || 0;

  const overlay = document.createElement("div");
  overlay.className = "levelup-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "levelupTitle");
  overlay.innerHTML = `
    <canvas class="levelup-fireworks" aria-hidden="true"></canvas>
    <div class="levelup-card">
      <div class="levelup-ribbon">LEVEL UP!</div>
      <div class="levelup-dog-wrap">
        <div class="levelup-glow" aria-hidden="true"></div>
        ${dogHtml}
      </div>
      <h2 class="levelup-title" id="levelupTitle">${escapeHtml(pet.name)}เลเวลอัพเป็นเลเวล <span>${pet.level}</span> แล้ว!</h2>
      ${bonus > 0 ? `
      <div class="levelup-bonus">
        <span class="levelup-bonus-icon" aria-hidden="true">🤖</span>
        <span><strong>ได้สิทธิ์ถาม AI ฟรี +${bonus} ข้อ</strong><small>ถามน้องหมาผู้ช่วยได้เลย ใช้ได้หลังโควต้ารายวันหมด</small></span>
      </div>` : ""}
      <div class="levelup-actions">
        ${bonus > 0 ? `<button type="button" class="levelup-btn levelup-btn-ghost" data-act="chat">ไปถาม AI</button>` : ""}
        <button type="button" class="levelup-btn" data-act="close">เย้! เยี่ยมเลย 🐾</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const stopFireworks = launchFireworks(overlay.querySelector(".levelup-fireworks"));
  const close = () => {
    stopFireworks();
    overlay.classList.add("closing");
    setTimeout(() => overlay.remove(), 250);
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "chat") {
      close();
      document.getElementById("chatBubbleBtn")?.click();
    } else if (act === "close" || e.target === overlay) {
      close();
    }
  });
  overlay.querySelector('[data-act="close"]').focus();
}

// พลุ: ยิงเป็นชุดๆ ราว 3 วินาทีแรก แล้วปล่อยให้ประกายจางหายเอง | ผู้ใช้ที่ตั้งลดการเคลื่อนไหวไว้ ไม่ยิงพลุ
function launchFireworks(canvas) {
  if (!canvas || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return () => {};
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const resize = () => {
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener("resize", resize);

  const COLORS = ["#ffd166", "#ff8fab", "#97bc62", "#7bdff2", "#ffffff", "#f4a261", "#cdb4db"];
  const particles = [];
  const burst = (x, y) => {
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const count = 46;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.2;
      const speed = 2.2 + Math.random() * 3.2;
      particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        decay: 0.011 + Math.random() * 0.01,
        size: 2 + Math.random() * 2.5,
        color: Math.random() < 0.25 ? "#ffffff" : color,
      });
    }
  };

  const started = performance.now();
  let nextBurst = 0;
  let raf = 0;
  const frame = (now) => {
    const t = now - started;
    if (t < 3200 && t >= nextBurst) {
      burst(innerWidth * (0.15 + Math.random() * 0.7), innerHeight * (0.12 + Math.random() * 0.4));
      nextBurst = t + 260 + Math.random() * 260;
    }
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.vx *= 0.985;
      p.vy = p.vy * 0.985 + 0.05;
      p.x += p.vx;
      p.y += p.vy;
      p.life -= p.decay;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.6 + p.life * 0.4), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (t < 3200 || particles.length) raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
  };
}

function petAction(type) {
  openBag(type);
}

// ================== Sidebar toggle + Logout (ใช้ร่วมกันทุกหน้า) ==================

function setupSidebarToggle() {
  const toggleBtn = document.getElementById("toggleBtn");
  const sidebar = document.getElementById("sidebar") || document.querySelector(".sidebar");

  if (toggleBtn && sidebar) {
    if (localStorage.getItem("sidebarCollapsed") === "1") {
      sidebar.classList.add("icon-collapsed");
    }
    toggleBtn.onclick = function (e) {
      e.stopPropagation();
      sidebar.classList.toggle("icon-collapsed");
      localStorage.setItem("sidebarCollapsed", sidebar.classList.contains("icon-collapsed") ? "1" : "0");
    };
  }
}

function bindLogout() {
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", (e) => {
      e.preventDefault();
      localStorage.removeItem("token");
      localStorage.removeItem("currentUser");
      window.location.href = "login.html";
    });
  }
}