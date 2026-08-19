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
    const { pet } = await apiFetch("/pet");
    currentPet = pet;

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
      await loadInventory(); // ของในกระเป๋ามาจากที่ซื้อไว้จริงในร้าน
      // รีเฟรชสถานะทุก 1 นาที เผื่อเปิดหน้าค้างไว้เฉยๆ จะได้เห็นค่าที่ลดลงตามเวลาจริงโดยไม่ต้องกดอะไร
      setInterval(refreshPetStats, 60000);
    }
  } catch (err) {
    console.error("โหลดข้อมูลสัตว์เลี้ยงไม่สำเร็จ:", err);
  }
});

async function refreshPetStats() {
  try {
    const { pet } = await apiFetch("/pet");
    if (!pet) return;
    currentPet = pet;
    updatePetUI(currentPet);
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

// ท่าทางของแต่ละพันธุ์ (ไฟล์ไหนยังไม่มีก็ไม่ต้องใส่ ระบบจะข้ามไปใช้ idle/อิโมจิสำรองแทนเอง)
//   idle      = Jumping ตัดแค่ 2 วิแรกก่อนโดด
//   levelUp   = Jumping คลิปเต็ม ตอนเลเวลอัพ
//   bath      = Shaking
//   holdPet   = Chasing ตอนกำลังลูบหัวค้างอยู่
//   happiness = ตอนปล่อยมือหลังลูบหัวเสร็จ / กดปุ่มเล่นด้วยกัน
//   sleep     = ท่านอน
//   low       = ความสุขต่ำกว่า 25% เท่านั้น
const PET_POSES = {
  thairidgeback: {
    feed: ["img/pets/thairidgeback-baby-feed-1.gif", "img/pets/thairidgeback-baby-feed-2.gif"],
    happiness: ["img/pets/thairidgeback-baby-happiness.gif"],
    low: ["img/pets/thairidgeback-baby-low.gif"], // เฉพาะความสุขต่ำกว่า 25%
    idle: ["img/pets/thairidgeback-baby-idle.gif"],
    levelUp: ["img/pets/thairidgeback-baby-levelup.gif"],
    bath: ["img/pets/thairidgeback-baby-bath.gif"],
    holdPet: ["img/pets/thairidgeback-baby-holdpet.gif"],
    sleep: ["img/pets/thairidgeback-baby-sleep.png"],
  },
};

function getPoseFrames(breed, poseKey) {
  return PET_POSES[breed]?.[poseKey] || null;
}

function renderPetPage(pet) {
  const petNameDisplay = document.getElementById("petName");
  if (petNameDisplay) petNameDisplay.innerText = pet.name;

  setPetImage(pet.breed);
  updatePetUI(pet);
  showSpeech("เจ้านาย มาเล่นด้วยกันเถอะ");
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
  };
  petImg.onerror = () => {
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

// เช็คว่ามีสถานะไหนต่ำกว่าเกณฑ์ไหม ถ้ามีโชว์ท่าเศร้าค้างไว้ ไม่มีก็กลับไปท่า idle ปกติ
// (ไม่ทำอะไรถ้ากำลังโชว์ท่ากิจกรรมชั่วคราวอยู่ กันแย่งกันโชว์)
function refreshPetMood() {
  if (!currentPet || showingTemporaryPose) return;

  // ท่าเศร้า (low) โชว์เฉพาะตอน "ความสุข" ต่ำกว่าเกณฑ์เท่านั้น (ไม่ใช่สถานะไหนก็ได้)
  const happinessLow = (currentPet.happiness ?? 100) < STAT_LOW_THRESHOLD;
  if (happinessLow) {
    const lowFrames = getPoseFrames(currentPet.breed, "low");
    if (lowFrames && lowFrames.length) {
      applyPetImageSrc(lowFrames[0], currentPet.breed);
      return;
    }
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
};

// ไอคอนสำรองต่อกระเป๋า ใช้เมื่อไอเทมนั้นโหลดรูปจากร้านไม่ขึ้น
const BAG_FALLBACK_ICON = { feed: "🍖", bath: "🧼", happiness: "🎾", sleep: "🛏️" };

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

  items.forEach((item) => {
    const imgSrc = resolveItemImg(item.img);
    const safeName = escapeHtml(item.name);
    const card = document.createElement("div");
    card.className = "item-card";
    card.innerHTML = `
      <span class="qty">x${item.count}</span>
      <div class="icon">${
        imgSrc
          ? `<img src="${escapeHtml(imgSrc)}" alt="${safeName}" onerror="this.replaceWith(document.createTextNode('${BAG_FALLBACK_ICON[bagKey]}'))">`
          : BAG_FALLBACK_ICON[bagKey]
      }</div>
      <div class="name">${safeName}</div>
      <div class="stat-gain">+${item.stat_gain}%</div>
      <button class="use-btn">ใช้</button>
    `;
    card.querySelector(".use-btn").addEventListener("click", () => useItem(item.id));
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
    currentPet = { ...currentPet, ...result.pet };
    updatePetUI(currentPet);
    bounceCharacter();
    showFloater("+" + result.amountGained);
    renderInventoryGrid(bagKey);

    if (result.leveledUp) {
      showPetPose("levelUp", 4000); // ท่าฉลองเลเวลอัพ สำคัญกว่าท่ากิจกรรมปกติ เลยแสดงแทน
      alert(result.message);
    } else {
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
      currentPet = { ...currentPet, ...result.pet };
      updatePetUI(currentPet);
      showSpeech(speeches.happiness);

      if (result.leveledUp) {
        showPetPose("levelUp", 4000); // ท่าฉลองเลเวลอัพ สำคัญกว่าท่า happiness ปกติ เลยแสดงแทน
        alert(result.message);
      } else {
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