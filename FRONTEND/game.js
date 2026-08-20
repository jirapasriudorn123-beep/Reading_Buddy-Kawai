// ================== Phayao Adventure ==================
// ลำดับฉากตอนนี้: คอมยังไม่เปิด (screen1) -> คลิก -> หน้า Title (screen2) -> คลิก
//                -> เลือกตัวละคร (screenChar) -> เลือกโลก/ด่าน (screenMap) -> ฉากสำรวจ (screenExplore)
// ทุกช่วงเปลี่ยนฉากใช้อนิเมชันวงกลมเปิดฉากเหมือนกันหมด
// ยังไม่มีตัวเกมจริงหลังเข้าฉากสำรวจ (เดินซ้าย-ขวาได้อย่างเดียว รอเพิ่มบทพูด/ควิซทีหลัง)

// ---------- อนิเมชันวงกลมเปิดฉาก (ใช้ซ้ำได้ทุกคู่ฉาก ไปข้างหน้าหรือย้อนกลับก็ได้) ----------
// ขยายวงกลมของ toEl จากจุดที่คลิกจนคลุมทั้งจอ แล้วค่อยซ่อน fromEl ไว้ข้างล่างสุด
// toEl ต้องยังไม่ถูกซ่อนอยู่ (display:none) ก่อนเรียก ไม่งั้นต่อให้วงกลมเปิดก็จะยังไม่โผล่มาให้เห็น
function circleReveal(fromEl, toEl, e, onDone) {
  // ป้องกัน window.innerWidth/innerHeight เป็น 0 (เช่น เผลอเรียกก่อนเลย์เอาต์พร้อม) ซึ่งจะทำให้ cx/cy กลาย
  // เป็น Infinity แล้ว clip-path ที่ได้กลายเป็นค่าไม่ถูกต้อง เบราว์เซอร์จะเงียบๆ ไม่ยอมตั้งค่าให้เลย (จอค้างมืด)
  let cx = e && e.clientX !== undefined ? (e.clientX / window.innerWidth) * 100 : 50;
  let cy = e && e.clientY !== undefined ? (e.clientY / window.innerHeight) * 100 : 50;
  if (!Number.isFinite(cx)) cx = 50;
  if (!Number.isFinite(cy)) cy = 50;
  const startClip = `circle(0% at ${cx}% ${cy}%)`;
  const endClip = `circle(150% at ${cx}% ${cy}%)`;

  toEl.style.transition = "none";
  toEl.style.clipPath = startClip;
  toEl.style.webkitClipPath = startClip;
  void toEl.offsetHeight; // บังคับให้เบราว์เซอร์อ่านค่าใหม่ก่อนเริ่ม transition

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toEl.style.transition = "clip-path 900ms cubic-bezier(.65,0,.35,1)";
      toEl.style.webkitTransition = "-webkit-clip-path 900ms cubic-bezier(.65,0,.35,1)";
      toEl.style.clipPath = endClip;
      toEl.style.webkitClipPath = endClip;
    });
  });

  fromEl.style.pointerEvents = "none";
  // ใช้ transitionend เป็นหลัก แต่กัน fallback ด้วย timeout เผื่อ event นี้ไม่ยิง (พบว่าไม่เสถียรในบางเบราว์เซอร์)
  // และกันเคส requestAnimationFrame โดน throttle จนไม่เริ่ม transition เลย (เช่นแท็บอยู่เบื้องหลังตอนคลิกพอดี)
  // ถ้าเกิดเหตุการณ์นี้ toEl จะค้างที่วงกลมรัศมี 0% -> จอดำ ไปต่อไม่ได้ จึง snap ให้เปิดเต็มที่เสมอตอนจบ
  let finished = false;
  const finishOpening = () => {
    if (finished) return;
    finished = true;
    fromEl.style.display = "none";
    toEl.style.transition = "none";
    toEl.style.clipPath = endClip;
    toEl.style.webkitClipPath = endClip;
    if (onDone) onDone();
  };
  toEl.addEventListener("transitionend", finishOpening, { once: true });
  setTimeout(finishOpening, 950);
}

document.addEventListener("DOMContentLoaded", () => {
  const screen1 = document.getElementById("screen1");
  const screen2 = document.getElementById("screen2");
  const screenChar = document.getElementById("screenChar");
  const screenMap = document.getElementById("screenMap");

  // ---------- SCREEN 1 -> SCREEN 2 ----------
  let opened1 = false;
  screen1.addEventListener("click", (e) => {
    if (opened1) return;
    opened1 = true;
    circleReveal(screen1, screen2, e);
  });

  // ---------- SCREEN 2 -> SCREEN CHAR (เลือกตัวละคร) ----------
  let opened2 = false;
  screen2.addEventListener("click", (e) => {
    if (opened2) return;
    opened2 = true;
    circleReveal(screen2, screenChar, e);
  });

  // ---------- SCREEN CHAR -> SCREEN MAP ----------
  let opened3 = false;
  document.querySelectorAll(".char-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (opened3) return;
      opened3 = true;
      setPlayerBreed(card.dataset.breed);
      circleReveal(screenChar, screenMap, e);
    });
  });

  applyPlayerBreedArt(); // ตั้งค่าเริ่มต้นไว้ก่อน เผื่อมีอะไรเรียกใช้ก่อนผู้ใช้เลือก
  setupDialogueControls();
  setupBattleControls();
  initWorldMap();
  loadAllQuizData(); // โหลดคำถามทั้งหมดล่วงหน้า (ไม่บล็อกการเปิดฉากอื่น)

  document.getElementById("exploreBackBtn").addEventListener("click", backToWorldMap);
});

// ================== หน้าเลือกโลก (World Select) ==================
// กล้อง: ซูมเข้าไปทีละโลก อยู่กึ่งกลางจอเสมอ เลื่อนซ้าย-ขวาได้ทั้งลากด้วยนิ้ว/เมาส์ และกดปุ่มลูกศร
const TOTAL_WORLDS = 6;
// จำนวนโลกที่ปลดล็อคแล้ว (ยังไม่ผูกกับ backend/ความคืบหน้าจริงของผู้เล่น เริ่มที่โลก 1 ไปก่อน)
let unlockedWorldCount = 1;

// ---------- ตำแหน่งด่าน (วงกลมสีเหลืองในภาพ) ต่อโลก ----------
// พิกัดอิงจากภาพต้นฉบับ world-select.png ขนาด 640x720 ต่อโลก 1 ช่อง เรียงตามลำดับเส้นทางที่เดินจริง
// ตอนนี้กำหนดไว้เฉพาะ World 1 (โลกเดียวที่ปลดล็อคอยู่ตอนนี้) โลกอื่นเว้นว่างไว้ก่อน รอเพิ่มทีหลัง
const STAGE_POSITIONS = [
  [
    { x: 176, y: 369 },
    { x: 301, y: 314 },
    { x: 301, y: 459 },
    { x: 463, y: 315 },
    { x: 584, y: 393 },
  ],
  [],
  [],
  [],
  [],
  [],
];
const WORLD_ART_SOURCE_W = 640;
const WORLD_ART_SOURCE_H = 720;

// ด่านที่น้องหมายืนอยู่ตอนนี้ในแต่ละโลก (index ใน STAGE_POSITIONS[world]) เริ่มที่ด่านแรกทุกโลก
const currentStageIdxByWorld = new Array(TOTAL_WORLDS).fill(0);
let dogWalkTimer = null;

let worldIdx = 0;
let worldCards = [];

// ภาพแถบโลกใช้ไฟล์เดียวคงที่เสมอ (สะพานทุกเส้นเป็นแบบปลดล็อคในภาพอยู่แล้ว ไม่มีล็อกฝังอยู่)
// ส่วนล็อกที่มองเห็นบนสะพานจริงๆ คือไอคอน KeyLock.png ที่วางทับด้วยโค้ดตรงนี้เอง ตาม unlockedWorldCount
const WORLD_STRIP_SRC = "img/game/world1-6/unlock5.png";

function initWorldMap() {
  const track = document.getElementById("worldCardTrack");
  if (!track) return;

  for (let i = 0; i < TOTAL_WORLDS; i++) {
    const card = document.createElement("div");
    card.className = "world-card";
    card.dataset.world = String(i);

    const art = document.createElement("div");
    art.className = "world-art";
    art.style.backgroundImage = `url('${WORLD_STRIP_SRC}')`;
    // ภาพแถบโลกกว้าง = 6 เท่าของการ์ด (background-size 600%) แล้วเลื่อนตำแหน่งเป็นขั้นละ 1/5 ของช่วงที่เหลือ
    // สูตร CSS background-position: (containerSize - bgSize) * percentage = -(i * containerWidth) เมื่อ bgSize คือ 600%
    art.style.backgroundPositionX = (i / (TOTAL_WORLDS - 1)) * 100 + "%";
    card.appendChild(art);

    const stages = STAGE_POSITIONS[i];
    if (stages.length) {
      stages.forEach((pos, si) => {
        const node = document.createElement("div");
        node.className = "stage-node";
        node.style.left = (pos.x / WORLD_ART_SOURCE_W) * 100 + "%";
        node.style.top = (pos.y / WORLD_ART_SOURCE_H) * 100 + "%";
        node.addEventListener("click", (ev) => {
          ev.stopPropagation();
          walkDogTo(i, si);
        });
        art.appendChild(node);
      });

      const dogMarker = document.createElement("div");
      dogMarker.className = "dog-marker";
      dogMarker.innerHTML = `<img src="img/game/${PLAYER_BREEDS[selectedPlayerBreed].logo}" alt="">`;
      positionDogMarker(dogMarker, stages[currentStageIdxByWorld[i]]);
      art.appendChild(dogMarker);
    }

    const locked = i >= unlockedWorldCount;
    if (locked) {
      card.classList.add("locked");
      const hint = document.createElement("div");
      hint.className = "lock-hint";
      hint.textContent = "ผ่านโลกก่อนหน้าก่อนถึงจะเล่นได้";
      card.appendChild(hint);
    }

    // ไอคอนกุญแจล็อกตรงรอยต่อ วางทับบนสะพานเมื่อ "โลกถัดไป" ยังไม่ปลดล็อค
    if (i < TOTAL_WORLDS - 1 && i + 1 >= unlockedWorldCount) {
      const lockBadge = document.createElement("div");
      lockBadge.className = "next-lock-badge";
      lockBadge.innerHTML = '<img src="img/game/world1-6/KeyLock.png" alt="">';
      card.appendChild(lockBadge);
    }

    track.appendChild(card);
    worldCards.push(card);
  }

  updateMapView(false);
  updateMapPlayBtn();

  document.getElementById("mapPrevBtn").addEventListener("click", () => goToWorld(worldIdx - 1));
  document.getElementById("mapNextBtn").addEventListener("click", () => goToWorld(worldIdx + 1));
  document.getElementById("mapGearBtn").addEventListener("click", resetGameProgress);
  document.getElementById("mapPlayBtn").addEventListener("click", enterFocusedWorld);

  setupMapDrag(track);
  window.addEventListener("resize", () => updateMapView(false));
}

function goToWorld(i) {
  worldIdx = Math.max(0, Math.min(TOTAL_WORLDS - 1, i));
  updateMapView(true);
  updateMapPlayBtn();
}

function updateMapView(animate) {
  const track = document.getElementById("worldCardTrack");
  if (!track || !worldCards.length) return;

  const cardWidth = worldCards[0].getBoundingClientRect().width;
  const gap = parseFloat(getComputedStyle(track).gap) || 0;
  const step = cardWidth + gap;
  const targetX = window.innerWidth / 2 - (step * worldIdx + cardWidth / 2);

  track.style.transition = animate ? "transform 420ms cubic-bezier(.65,0,.35,1)" : "none";
  track.style.transform = `translateX(${targetX}px)`;

  document.getElementById("mapPrevBtn").classList.toggle("hidden", worldIdx === 0);
  document.getElementById("mapNextBtn").classList.toggle("hidden", worldIdx === TOTAL_WORLDS - 1);
}

function updateMapPlayBtn() {
  const playBtn = document.getElementById("mapPlayBtn");
  playBtn.disabled = worldIdx >= unlockedWorldCount;
}

function enterFocusedWorld(e) {
  if (worldIdx >= unlockedWorldCount) return; // โลกนี้ยังไม่ปลดล็อค กดเข้าไม่ได้
  const config = WORLD_SCENE[worldIdx];
  if (!config) {
    alert("โลกนี้ยังไม่มีฉากให้เล่น (รอเพิ่มทีหลัง)");
    return;
  }
  const screenMapEl = document.getElementById("screenMap");
  const screenExploreEl = document.getElementById("screenExplore");
  // เผื่อเคยกลับออกมาจากฉากนี้แล้ว (fromEl ครั้งก่อนถูกซ่อนด้วย display:none ไว้) ต้องเปิดให้เห็นก่อนเรียก circleReveal
  // และต้องเปิดก่อน initExploreCharacter() ด้วย เพราะตอนยัง display:none วัดขนาดฉากไม่ได้ (ได้ 0) กล้องจะคำนวณผิด
  screenExploreEl.style.display = "block";
  screenExploreEl.style.pointerEvents = "";

  loadWorldScene(config);
  applyWorldGround(worldIdx);
  initExploreCharacter();

  circleReveal(screenMapEl, screenExploreEl, e);
}

function backToWorldMap(e) {
  const screenMapEl = document.getElementById("screenMap");
  const screenExploreEl = document.getElementById("screenExplore");
  screenMapEl.style.display = "block";
  screenMapEl.style.pointerEvents = "";
  circleReveal(screenExploreEl, screenMapEl, e);

  playerMoveDir = 0;
  if (dialogueActive) endDialogue(); // กันกล่องคำพูดค้างตอนกดกลับกลางบทสนทนา
  if (playerAnimTimer) clearInterval(playerAnimTimer);
  if (playerRafId) cancelAnimationFrame(playerRafId);
}

function positionDogMarker(markerEl, pos) {
  markerEl.style.left = (pos.x / WORLD_ART_SOURCE_W) * 100 + "%";
  markerEl.style.top = (pos.y / WORLD_ART_SOURCE_H) * 100 + "%";
}

// น้องหมาเดินไปด่านที่กด โดยเดินผ่านทีละด่านตามลำดับเส้นทางจริง (ไม่ใช่กระโดดตรงข้ามด่าน)
function walkDogTo(worldI, targetStageIdx) {
  const stages = STAGE_POSITIONS[worldI];
  const card = worldCards[worldI];
  const marker = card && card.querySelector(".dog-marker");
  if (!marker || !stages.length) return;

  clearTimeout(dogWalkTimer);
  let cur = currentStageIdxByWorld[worldI];
  if (cur === targetStageIdx) return;
  const dir = targetStageIdx > cur ? 1 : -1;

  const step = () => {
    cur += dir;
    positionDogMarker(marker, stages[cur]);
    currentStageIdxByWorld[worldI] = cur;
    if (cur !== targetStageIdx) {
      dogWalkTimer = setTimeout(step, 380);
    }
  };
  step();
}

function resetGameProgress() {
  if (!confirm("รีเซ็ตความคืบหน้าเกมทั้งหมดกลับไปเริ่มที่โลก 1?")) return;
  unlockedWorldCount = 1;
  currentStageIdxByWorld.fill(0);
  worldCards.forEach((card) => card.remove());
  worldCards = [];
  worldIdx = 0;
  document.getElementById("worldCardTrack").innerHTML = "";
  initWorldMap();
}

// ---------- ลากด้วยนิ้ว/เมาส์เพื่อเลื่อนดูโลกอื่น ----------
function setupMapDrag(track) {
  let dragging = false;
  let startX = 0;
  let baseX = 0;
  let moved = false;

  const getX = (ev) => (ev.touches ? ev.touches[0].clientX : ev.clientX);

  const onDown = (ev) => {
    dragging = true;
    moved = false;
    startX = getX(ev);
    baseX = getTranslateX(track);
    track.style.transition = "none";
  };
  const onMove = (ev) => {
    if (!dragging) return;
    const dx = getX(ev) - startX;
    if (Math.abs(dx) > 4) moved = true;
    track.style.transform = `translateX(${baseX + dx}px)`;
  };
  const onUp = (ev) => {
    if (!dragging) return;
    dragging = false;
    const dx = (ev.changedTouches ? ev.changedTouches[0].clientX : ev.clientX) - startX;
    if (moved && Math.abs(dx) > 60) {
      goToWorld(dx < 0 ? worldIdx + 1 : worldIdx - 1);
    } else {
      updateMapView(true); // ลากไม่พอ ให้เด้งกลับที่เดิม
    }
  };

  track.addEventListener("mousedown", onDown);
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  track.addEventListener("touchstart", onDown, { passive: true });
  track.addEventListener("touchmove", onMove, { passive: true });
  track.addEventListener("touchend", onUp);
}

function getTranslateX(el) {
  const style = window.getComputedStyle(el);
  const matrix = style.transform;
  if (!matrix || matrix === "none") return 0;
  const match = matrix.match(/matrix\(([^)]+)\)/);
  if (!match) return 0;
  const parts = match[1].split(",").map((v) => parseFloat(v));
  return parts[4] || 0;
}

// ================== หน้าสำรวจโลก (ฉากนิ่ง + ตัวละครเดินสำรวจ หลังกด Play) ==================
// ฉากของแต่ละโลก ใช้ภาพเดียวเต็มฉาก (ไม่ใช้ระบบ parallax แยกเลเยอร์แล้ว)
// ลำดับตรงกับลำดับโลกบนแผนที่ 1-6
const WORLD_SCENE = [
  "CH1.png",    // World 1: มหาวิทยาลัยพะเยา
  "CH2.png",    // World 2: วัดพระใหญ่
  "CH3png.png", // World 3: กำแพงเมือง/ตลาด (ชื่อไฟล์สะกดแบบนี้จริงในโฟลเดอร์)
  "CH4.png",    // World 4: ทุ่งหญ้าเชิงเขา
  "CH5.png",    // World 5: ริมกว๊านยามเย็น
  "CH6.png",    // World 6: ป่าน้ำตก
];

// ระดับพื้นที่ตัวละครยืนในแต่ละโลก (นับจากขอบล่างของฉาก เป็น % ของความสูงฉาก)
// แต่ละฉากวาดพื้นไว้คนละความสูง ถ้าใช้ค่าเดียวกันหมดตัวละครจะลอยหรือจมพื้น
const WORLD_GROUND_PCT = [
  29, // World 1: บนสะพานไม้ (แนวเดียวกับคนที่ยืนอยู่บนสะพาน)
  9,  // World 2: ลานหน้าวัด
  9,  // World 3: ถนนหน้าตลาด
  9,  // World 4: ทางเดินในทุ่ง
  9,  // World 5: สะพานไม้ริมกว๊าน
  9,  // World 6: สะพานไม้ในป่า
];

// ย้ายตัวละครกับ NPC ไปยืนที่ระดับพื้นของโลกนั้น
function applyWorldGround(worldI) {
  const groundPct = WORLD_GROUND_PCT[worldI] ?? 9;
  const player = document.getElementById("playerChar");
  const npc = document.getElementById("npcTeacher");
  if (player) player.style.bottom = `${groundPct}%`;
  if (npc) npc.style.bottom = `${groundPct}%`;
}

function loadWorldScene(file) {
  const layerEls = document.querySelectorAll("#parallaxStage .parallax-layer");
  // ใช้ชั้นล่างสุดวางภาพฉากทั้งภาพ ส่วนชั้นที่เหลือเคลียร์ทิ้ง (เก็บ element ไว้เผื่ออนาคต)
  layerEls.forEach((el, i) => {
    el.style.backgroundImage = i === 0 ? `url('img/game/world_select/${file}')` : "none";
  });
}

// ================== บทสนทนากับ NPC ==================
// บทพูดมาจาก GAME_VN_LINES ในไฟล์ game-content.js (แยกเนื้อหาออกจากโค้ด แก้ข้อความได้โดยไม่ต้องแตะไฟล์นี้)
// ระหว่างที่กล่องคำพูดเปิดอยู่ ผู้เล่นจะเดินไม่ได้ ต้องแตะไล่บทพูดให้จบก่อน

let dialogueActive = false;
let dialogueLines = [];
let dialogueIndex = 0;
let dialogueOnDone = null;

function startDialogue(lines, onDone) {
  const box = document.getElementById("dialogueBox");
  if (!box || !lines || !lines.length) return;

  dialogueLines = lines;
  dialogueIndex = 0;
  dialogueOnDone = onDone || null;
  dialogueActive = true;
  playerMoveDir = 0; // หยุดเดินทันทีถ้ากำลังเดินค้างอยู่
  setTalkButtonVisible(false); // ซ่อนปุ่มคุยทันที ไม่ต้องรอลูปเฟรมถัดไป

  document.getElementById("screenExplore").classList.add("talking");
  box.classList.add("show");
  renderDialogueLine();
}

function renderDialogueLine() {
  const textEl = document.getElementById("dialogueText");
  if (textEl) textEl.textContent = dialogueLines[dialogueIndex];
}

function advanceDialogue() {
  if (!dialogueActive) return;
  dialogueIndex += 1;

  if (dialogueIndex >= dialogueLines.length) {
    endDialogue();
    return;
  }
  renderDialogueLine();
}

function endDialogue() {
  const box = document.getElementById("dialogueBox");
  dialogueActive = false;
  if (box) box.classList.remove("show");
  document.getElementById("screenExplore").classList.remove("talking");

  const done = dialogueOnDone;
  dialogueOnDone = null;
  if (done) done();
}

// ---------- ปุ่ม "คุย" ที่โผล่ตอนเดินเข้าใกล้อาจารย์ ----------

function setTalkButtonVisible(show) {
  const btn = document.getElementById("talkBtn");
  if (btn) btn.classList.toggle("show", show);
}

// เรียกทุกเฟรมจากลูปเดิน: อยู่ใกล้อาจารย์พอ + ยังไม่เคยคุย + ไม่ได้กำลังคุยอยู่ → โชว์ปุ่ม
function updateTalkPrompt() {
  const nearTeacher = Math.abs(playerXPct - NPC_X_PCT) <= TALK_RANGE_PCT;
  setTalkButtonVisible(nearTeacher && !talkedToTeacher && !dialogueActive);
}

// คุยกับอาจารย์จบแล้ว → เปิดด่านกั้นให้เดินต่อได้
function openStageBarrier() {
  talkedToTeacher = true;
  barrierOpen = true;
  const barrierEl = document.getElementById("stageBarrier");
  if (barrierEl) barrierEl.classList.add("open");
  setTalkButtonVisible(false);
}

function talkToTeacher() {
  if (dialogueActive || talkedToTeacher) return;
  // หันหน้าเข้าหาอาจารย์ก่อนเริ่มคุย
  const el = document.getElementById("playerChar");
  playerFacing = playerXPct >= NPC_X_PCT ? -1 : 1;
  if (el) applyPlayerTransform(el);

  startDialogue(GAME_VN_LINES, openStageBarrier);
}

// แตะที่กล่องคำพูดหรือที่ไหนก็ได้ในฉาก เพื่อไปบทพูดถัดไป
function setupDialogueControls() {
  const box = document.getElementById("dialogueBox");
  const screen = document.getElementById("screenExplore");
  const talkBtn = document.getElementById("talkBtn");
  if (box) box.addEventListener("click", advanceDialogue);
  if (talkBtn) {
    talkBtn.addEventListener("click", (e) => {
      e.stopPropagation(); // กันไม่ให้คลิกนี้ทะลุไปนับเป็นการไล่บทพูดบรรทัดแรกทันที
      talkToTeacher();
    });
  }
  if (screen) {
    screen.addEventListener("click", (e) => {
      // ปุ่มย้อนกลับ/ปุ่มเดิน ไม่ให้นับเป็นการกดไล่บทพูด
      if (!dialogueActive || e.target.closest("button")) return;
      advanceDialogue();
    });
  }
  document.addEventListener("keydown", (e) => {
    if (dialogueActive && (e.key === " " || e.key === "Enter")) {
      e.preventDefault();
      advanceDialogue();
    }
  });
}


// ================== ระบบต่อสู้ (ควิซ) ==================
// เดินเข้าใกล้ตัวร้าย -> วงกลมเปิดฉาก -> หน้าต่อสู้
// ตอบถูก = ตัวร้ายแดง+เด้ง เลือดลด 1 | ตอบผิด = น้องหมาแดง+เด้ง หัวใจลด 1
// ชนะเมื่อเลือดตัวร้ายหมด | แพ้เมื่อหัวใจหมด หรือหมดเวลา

const ENEMY_X_PCT = 88;        // ตำแหน่งตัวร้ายในฉากสำรวจ
const ENEMY_TRIGGER_PCT = 8;   // เข้าใกล้แค่ไหนถึงเข้าโหมดต่อสู้
const ENEMY_MAX_HP = 10;       // เลือดตัวร้าย (ตอบถูก 1 ข้อ = ลด 1)
const PLAYER_MAX_HEARTS = 3;   // หัวใจผู้เล่น (ตอบผิด 1 ข้อ = ลด 1)
const BATTLE_SECONDS = 10 * 60; // เวลาต่อสู้ 10 นาที
const STAGES_PER_WORLD = 5;

// ชื่อบทเรียนของแต่ละโลก ใช้โชว์เป็นหัวข้อคำถาม
const WORLD_CHAPTER_TITLE = [
  "ระบบเลขฐาน",
  "ขั้นตอนการคิดและการแก้ปัญหาเชิงตรรกะ",
  "ตรรกะพื้นฐาน",
  "อัลกอริทึม",
  "รูปแบบการพัฒนาโปรแกรม",
  "พื้นฐานการเขียนโปรแกรมและการนำไปใช้",
];

const BREED_NAME_TH = {
  golden: "โกลเด้นรีทรีฟเวอร์",
  shiba: "ชิบะอินุ",
  siberian: "ไซบีเรียนฮัสกี้",
  thairidgeback: "สุนัขไทยหลังอาน",
};

let battleActive = false;
let enemyEncountered = false; // เจอตัวร้ายไปแล้วในรอบนี้ (กันลูปเดินสั่งเข้าต่อสู้ซ้ำทันทีหลังจบการต่อสู้)
let battleQuiz = [];
let battleTopic = "";
let battleQuizIndex = 0;
let enemyHp = ENEMY_MAX_HP;
let playerHearts = PLAYER_MAX_HEARTS;
let battleTimeLeft = BATTLE_SECONDS;
let battleTimerId = null;

// ================== คำถามควิซ (ดึงจากฐานข้อมูลผ่าน /api/game/quiz/...) ==================
// แอดมินแก้ไขคำถามได้ที่ admingame-edit.html (รายบท) / admingame-dogs.html (รายพันธุ์สุนัข)
// โหลดทั้งหมดไว้ล่วงหน้าตอนเปิดหน้าเกม (ข้อมูลมีไม่เยอะ) เพื่อให้ pickQuizForStage ยังเป็น sync ได้เหมือนเดิม
const QUIZ_CHAPTER_NUMBERS = [1, 2, 3, 4, 5, 6];
const QUIZ_BREED_KEYS = ["golden", "shiba", "siberian", "thairidgeback"];
let quizByChapter = {};
let quizByBreed = {};

function mapQuizRows(rows) {
  return (rows || []).map((r) => ({
    q: r.question,
    opts: [r.option_1, r.option_2, r.option_3, r.option_4],
    a: r.correct_option - 1,
  }));
}

async function fetchQuizList(path) {
  const token = localStorage.getItem("token");
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`โหลดคำถามไม่สำเร็จ: ${path}`);
  const data = await res.json();
  return mapQuizRows(data.questions);
}

async function loadAllQuizData() {
  try {
    const [chapterLists, breedLists] = await Promise.all([
      Promise.all(QUIZ_CHAPTER_NUMBERS.map((n) => fetchQuizList(`/game/quiz/chapter/${n}`))),
      Promise.all(QUIZ_BREED_KEYS.map((b) => fetchQuizList(`/game/quiz/breed/${b}`))),
    ]);
    QUIZ_CHAPTER_NUMBERS.forEach((n, i) => (quizByChapter[n] = chapterLists[i]));
    QUIZ_BREED_KEYS.forEach((b, i) => (quizByBreed[b] = breedLists[i]));
  } catch (err) {
    console.error("โหลดชุดคำถามจากฐานข้อมูลไม่สำเร็จ:", err);
  }
}

// เลือกชุดคำถามตามด่าน: ด่าน 1,3,5 = คำถามจากบทเรียนของโลกนั้น | ด่าน 2,4 = คำถามพันธุ์สุนัขที่เลือก
// stageNo นับเริ่มที่ 1
function pickQuizForStage(worldI, stageNo) {
  const useBreedQuiz = stageNo % 2 === 0;
  if (useBreedQuiz) {
    return {
      list: quizByBreed[selectedPlayerBreed] || [],
      topic: `พันธุ์${BREED_NAME_TH[selectedPlayerBreed] || "สุนัข"}`,
    };
  }
  const chapterNo = worldI + 1;
  return {
    list: quizByChapter[chapterNo] || [],
    topic: WORLD_CHAPTER_TITLE[worldI] || `บทที่ ${chapterNo}`,
  };
}

// สลับลำดับคำถามแบบสุ่ม เล่นซ้ำจะได้ไม่เจอลำดับเดิม
function shuffled(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function currentStageNo() {
  return (currentStageIdxByWorld[worldIdx] || 0) + 1;
}

// เดินเข้าใกล้ตัวร้ายเมื่อไหร่ก็เข้าโหมดต่อสู้ทันที (เรียกทุกเฟรมจากลูปเดิน)
function checkEnemyEncounter() {
  if (battleActive || dialogueActive || enemyEncountered) return;
  if (Math.abs(playerXPct - ENEMY_X_PCT) > ENEMY_TRIGGER_PCT) return;

  playerMoveDir = 0; // หยุดเดินก่อนเข้าฉากต่อสู้
  startBattle();
}

function startBattle(e) {
  if (battleActive) return;

  const stageNo = currentStageNo();
  const { list, topic } = pickQuizForStage(worldIdx, stageNo);

  if (!list.length) {
    alert(`ด่านนี้ยังไม่มีคำถาม (${topic})\nเพิ่มคำถามได้ที่หน้าแอดมิน (จัดการมินิเกม)`);
    return;
  }

  battleActive = true;
  enemyEncountered = true;
  // สุ่มคำถามจากคลังทั้งหมดมาแค่ 10 ข้อต่อการต่อสู้ 1 ครั้ง (ถ้าคลังมีน้อยกว่า 10 ก็ใช้เท่าที่มี)
  battleQuiz = shuffled(list).slice(0, ENEMY_MAX_HP);
  battleQuizIndex = 0;
  // เลือดตัวร้ายไม่เกินจำนวนคำถามที่มี ไม่งั้นตอบครบทุกข้อแล้วก็ยังฆ่าไม่ตาย
  enemyHp = Math.min(ENEMY_MAX_HP, battleQuiz.length);
  playerHearts = PLAYER_MAX_HEARTS;
  battleTimeLeft = BATTLE_SECONDS;

  battleTopic = topic;
  document.getElementById("quizLevel").textContent = `บทที่ ${worldIdx + 1}`;
  document.getElementById("battleResult").classList.remove("show");
  document.getElementById("battleDog").style.backgroundImage =
    `url('img/game/${PLAYER_BREEDS[selectedPlayerBreed].sprite}')`;

  renderHearts();
  renderEnemyHp();
  renderQuizQuestion();
  startBattleTimer();

  // หยุดลูปเดิน/อนิเมชันของฉากสำรวจไว้ก่อน ระหว่างอยู่ในหน้าต่อสู้
  if (playerRafId) cancelAnimationFrame(playerRafId);
  if (playerAnimTimer) clearInterval(playerAnimTimer);

  const screenExploreEl = document.getElementById("screenExplore");
  const screenBattleEl = document.getElementById("screenBattle");
  screenBattleEl.style.display = "block";
  screenBattleEl.style.pointerEvents = "";
  circleReveal(screenExploreEl, screenBattleEl, e);
}

function renderHearts() {
  const wrap = document.getElementById("battleHearts");
  wrap.innerHTML = "";
  for (let i = 0; i < PLAYER_MAX_HEARTS; i++) {
    const h = document.createElement("div");
    h.className = "heart" + (i >= playerHearts ? " lost" : "");
    wrap.appendChild(h);
  }
}

function renderEnemyHp() {
  const fill = document.getElementById("enemyHpFill");
  const maxHp = Math.min(ENEMY_MAX_HP, battleQuiz.length) || 1;
  if (fill) fill.style.width = `${(enemyHp / maxHp) * 100}%`;
}

function renderQuizQuestion() {
  const item = battleQuiz[battleQuizIndex % battleQuiz.length];
  document.getElementById("quizQuestion").textContent = item.q;
  document.getElementById("quizTopic").textContent = `คำถามที่ ${battleQuizIndex + 1} : ${battleTopic}`;

  const wrap = document.getElementById("quizOptions");
  wrap.innerHTML = "";
  item.opts.forEach((text, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "quiz-opt";
    btn.textContent = text;
    btn.addEventListener("click", () => answerQuiz(i, item.a, wrap));
    wrap.appendChild(btn);
  });
}

function answerQuiz(picked, correct, wrap) {
  const buttons = [...wrap.querySelectorAll(".quiz-opt")];
  buttons.forEach((b) => (b.disabled = true));
  buttons[correct].classList.add("correct");

  if (picked === correct) {
    enemyHp -= 1;
    renderEnemyHp();
    flashHit("battleEnemy");
  } else {
    buttons[picked].classList.add("wrong");
    playerHearts -= 1;
    renderHearts();
    flashHit("battleDog");
  }

  setTimeout(() => {
    if (enemyHp <= 0) return endBattle(true, "ตัวร้ายพ่ายแพ้แล้ว!");
    if (playerHearts <= 0) return endBattle(false, "หัวใจหมดแล้ว ลองใหม่อีกครั้งนะ");
    battleQuizIndex += 1;
    renderQuizQuestion();
  }, 900);
}

// ตัวแดงแล้วเด้ง (ใช้ทั้งตอนตัวร้ายโดนตีและตอนน้องหมาตอบผิด)
function flashHit(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.classList.remove("hit-flash");
  void el.offsetWidth; // บังคับให้เบราว์เซอร์เริ่มอนิเมชันใหม่ ถ้าโดนตีรัวๆ ติดกัน
  el.classList.add("hit-flash");
  setTimeout(() => el.classList.remove("hit-flash"), 460);
}

function startBattleTimer() {
  clearInterval(battleTimerId);
  updateBattleTimerLabel();
  battleTimerId = setInterval(() => {
    battleTimeLeft -= 1;
    updateBattleTimerLabel();
    if (battleTimeLeft <= 0) endBattle(false, "หมดเวลาแล้ว!");
  }, 1000);
}

function updateBattleTimerLabel() {
  const m = Math.floor(Math.max(0, battleTimeLeft) / 60);
  const s = Math.max(0, battleTimeLeft) % 60;
  const label = document.getElementById("battleTimer");
  if (label) label.textContent = `${String(m).padStart(2, "0")} : ${String(s).padStart(2, "0")}`;
  document.querySelector(".battle-timer").classList.toggle("urgent", battleTimeLeft <= 60);
}

function endBattle(won, message) {
  clearInterval(battleTimerId);
  battleActive = false;

  const box = document.getElementById("battleResult");
  document.getElementById("battleResultTitle").textContent = won ? "ผ่านด่าน!" : "แพ้แล้ว";
  document.getElementById("battleResultText").textContent = message;
  document.getElementById("battleResultBtn").textContent = won ? "ไปด่านถัดไป" : "ลองใหม่";
  box.classList.add("show");

  if (won) advanceStageProgress();
}

// ผ่านด่านแล้วเลื่อนไปด่านถัดไป (ครบ 5 ด่านของโลกนี้ก็ปลดล็อคโลกถัดไป)
function advanceStageProgress() {
  const stageIdx = currentStageIdxByWorld[worldIdx] || 0;
  if (stageIdx + 1 < STAGES_PER_WORLD) {
    currentStageIdxByWorld[worldIdx] = stageIdx + 1;
  } else if (unlockedWorldCount < TOTAL_WORLDS) {
    unlockedWorldCount += 1;
  }
}

// กดปุ่มบนหน้าผลการต่อสู้ -> กลับไปแผนที่โลก แล้วสร้างแผนที่ใหม่ให้ตรงกับความคืบหน้าล่าสุด
function leaveBattle(e) {
  const screenBattleEl = document.getElementById("screenBattle");
  const screenMapEl = document.getElementById("screenMap");
  document.getElementById("battleResult").classList.remove("show");

  screenMapEl.style.display = "block";
  screenMapEl.style.pointerEvents = "";
  circleReveal(screenBattleEl, screenMapEl, e);

  // ฉากสำรวจถูกซ่อนไว้ตอนเข้าต่อสู้ ต้องรีเซ็ตให้พร้อมสำหรับรอบหน้า
  document.getElementById("screenExplore").style.display = "none";
  if (playerRafId) cancelAnimationFrame(playerRafId);
  if (playerAnimTimer) clearInterval(playerAnimTimer);

  worldCards.forEach((card) => card.remove());
  worldCards = [];
  document.getElementById("worldCardTrack").innerHTML = "";
  initWorldMap();
}

function setupBattleControls() {
  const btn = document.getElementById("battleResultBtn");
  if (btn) btn.addEventListener("click", leaveBattle);
}

// ---------- ตัวละคร (น้องหมา) เดินซ้าย/ขวาสำรวจฉาก ด้วยปุ่มลูกศรหรือคีย์บอร์ด ----------
// ---------- พันธุ์ที่เลือกได้ในหน้าเลือกตัวละคร ----------
// สไปรต์ทุกพันธุ์เป็นกริดขนาดเดียวกันหมด (688x1548 = 4 คอลัมน์ x 9 แถว ช่องละ 172x172px)
// เลยสลับพันธุ์ได้แค่เปลี่ยนไฟล์ภาพ ไม่ต้องแก้ค่าอนิเมชันอะไรเลย
const PLAYER_BREEDS = {
  golden: { sprite: "golden.png", logo: "Logo_golden.png" },
  shiba: { sprite: "shiba.png", logo: "Logo_shiba.png" },
  siberian: { sprite: "Siberian-transparent.png", logo: "Logo_Siberian.png" },
  // ไฟล์ต้นฉบับ thairidgeback.png พื้นหลังแถวแรก (แถวที่ใช้เดิน) เป็นสีดำทึบ ขึ้นเป็นกล่องดำในเกม
  // เลยใช้เวอร์ชันที่ลบพื้นหลังออกแล้วแทน (ตั้งชื่อแบบเดียวกับ Siberian-transparent.png)
  thairidgeback: { sprite: "thairidgeback-transparent.png", logo: "Logo_thairidgeback.png" },
};

let selectedPlayerBreed = "golden"; // ค่าเริ่มต้นเผื่อยังไม่ได้เลือก

function setPlayerBreed(breed) {
  if (!PLAYER_BREEDS[breed]) return;
  selectedPlayerBreed = breed;
  applyPlayerBreedArt();
}

// อัปเดตทั้งสไปรต์ตัวเดินในฉากสำรวจ และไอคอนหมุดบนแผนที่โลก ให้เป็นพันธุ์ที่เลือก
function applyPlayerBreedArt() {
  const breed = PLAYER_BREEDS[selectedPlayerBreed];

  const playerEl = document.getElementById("playerChar");
  if (playerEl) playerEl.style.backgroundImage = `url('img/game/${breed.sprite}')`;

  document.querySelectorAll(".dog-marker img").forEach((img) => {
    img.src = `img/game/${breed.logo}`;
  });
}

// สไปรต์แต่ละพันธุ์เป็นกริด 4 คอลัมน์ x 9 แถว ช่องละ 172x172px แถวแรก (แถว 0) คือท่าวิ่งหันขวา 4 เฟรม
const DOG_SPRITE_COLS = 4;
const DOG_WALK_FRAME_MS = 120;
const PLAYER_SPEED_PCT_PER_SEC = 18; // ความเร็วเดิน เป็น % ความกว้างฉากต่อวินาที
const PLAYER_MIN_PCT = 6;
const PLAYER_MAX_PCT = 94;

// ---------- ด่านในฉากสำรวจ ----------
const NPC_X_PCT = 26;      // ตำแหน่งอาจารย์ติ๊กในฉาก (ต้องตรงกับ left ของ .npc-char ใน game.css)
const BARRIER_X_PCT = 54;  // ตำแหน่งด่านกั้น เปิดหลังคุยกับอาจารย์จบ
const TALK_RANGE_PCT = 10; // เข้าใกล้อาจารย์แค่ไหนถึงจะขึ้นปุ่ม "คุย"
const BARRIER_STOP_MARGIN = 4; // หยุดห่างจากด่านกั้นเท่าไหร่ (กันตัวละครทับด่าน)

let barrierOpen = false;      // ด่านกั้นเปิดแล้วหรือยัง
let talkedToTeacher = false;  // คุยกับอาจารย์จบแล้วหรือยัง

let playerXPct = 50;
let playerFacing = 1; // 1 = ขวา, -1 = ซ้าย
let playerMoveDir = 0; // -1, 0, 1 (ทิศที่กำลังกดค้างอยู่)
let playerWalkFrame = 0;
let playerAnimTimer = null;
let playerRafId = null;
let playerControlsBound = false; // กันไม่ให้ผูก listener ปุ่ม/คีย์บอร์ดซ้ำเวลาเข้าฉากสำรวจซ้ำหลายรอบ

function applyPlayerSpriteFrame(el) {
  const colPct = (playerWalkFrame / (DOG_SPRITE_COLS - 1)) * 100;
  el.style.backgroundPosition = `${colPct}% 0%`;
}

function applyPlayerTransform(el) {
  el.style.left = `${playerXPct}%`;
  el.style.transform = `translateX(-50%) scaleX(${playerFacing})`;
  updateCamera();
}

// ================== กล้อง: ซูมเข้าฉาก แล้วเลื่อนตามตัวผู้เล่น ==================
// โลกของฉาก (#sceneWorld) ถูกทำให้กว้างกว่าจอตาม SCENE_ZOOM แล้วกล้องเลื่อนกล่องนี้
// ไปทางตรงข้ามกับที่ผู้เล่นเดิน เพื่อให้ตัวผู้เล่นอยู่กลางจอเสมอ (ยกเว้นตอนชนขอบฉาก)
const SCENE_ZOOM = 1.3; // 1 = เห็นฉากเต็มพอดีจอ | มากกว่า 1 = ซูมเข้า และกล้องจะเลื่อนตามตัวผู้เล่น
const SCENE_ASPECT = 1376 / 768;

function layoutSceneWorld() {
  const stage = document.getElementById("parallaxStage");
  const world = document.getElementById("sceneWorld");
  if (!stage || !world) return;

  const stageH = stage.clientHeight;
  const stageW = stage.clientWidth;

  // ฉากสูงเท่าจอคูณระดับซูม แล้วกว้างตามสัดส่วนภาพต้นฉบับ
  let worldH = stageH * SCENE_ZOOM;
  let worldW = worldH * SCENE_ASPECT;

  // กันเคสจอกว้างมากจนฉากแคบกว่าจอ (จะเห็นขอบดำสองข้าง) ให้ขยายจนคลุมจออย่างน้อยเท่าจอ
  if (worldW < stageW) {
    worldW = stageW;
    worldH = worldW / SCENE_ASPECT;
  }

  world.style.width = `${worldW}px`;
  world.style.height = `${worldH}px`;
  updateCamera();
}

function updateCamera() {
  const stage = document.getElementById("parallaxStage");
  const world = document.getElementById("sceneWorld");
  if (!stage || !world) return;

  const stageW = stage.clientWidth;
  const worldW = world.offsetWidth;
  if (!worldW) return;

  // ตำแหน่งผู้เล่นในหน่วยพิกเซลของโลกฉาก แล้วดึงกล้องให้ผู้เล่นอยู่กลางจอ
  const playerX = (playerXPct / 100) * worldW;
  const maxOffset = Math.max(0, worldW - stageW);
  const offset = Math.min(maxOffset, Math.max(0, playerX - stageW / 2));

  world.style.transform = `translateX(${-offset}px)`;
}

window.addEventListener("resize", layoutSceneWorld);

function initExploreCharacter() {
  const el = document.getElementById("playerChar");
  const leftBtn = document.getElementById("exploreLeftBtn");
  const rightBtn = document.getElementById("exploreRightBtn");
  if (!el || !leftBtn || !rightBtn) return;

  // เกิดที่ซ้ายสุดของฉาก หันหน้าไปทางขวา แล้วเดินไปหาอาจารย์เอง
  playerXPct = PLAYER_MIN_PCT;
  playerFacing = 1;
  playerWalkFrame = 0;

  // รีเซ็ตด่านทุกครั้งที่เข้าฉากใหม่
  barrierOpen = false;
  talkedToTeacher = false;
  const barrierEl = document.getElementById("stageBarrier");
  if (barrierEl) {
    barrierEl.style.left = `${BARRIER_X_PCT}%`;
    barrierEl.classList.remove("open");
  }
  // ปุ่มคุยกับกล่องคำพูด ลอยอยู่เหนือหัวอาจารย์ทั้งคู่ (ไม่โผล่พร้อมกัน)
  const talkBtnEl = document.getElementById("talkBtn");
  if (talkBtnEl) talkBtnEl.style.left = `${NPC_X_PCT}%`;
  const dialogueBoxEl = document.getElementById("dialogueBox");
  if (dialogueBoxEl) dialogueBoxEl.style.left = `${NPC_X_PCT}%`;

  // ตัวร้ายรออยู่ปลายทาง เดินเข้าใกล้แล้วจะเข้าโหมดต่อสู้
  enemyEncountered = false;
  const enemyEl = document.getElementById("enemyField");
  if (enemyEl) {
    enemyEl.style.left = `${ENEMY_X_PCT}%`;
    enemyEl.style.bottom = `${WORLD_GROUND_PCT[worldIdx] ?? 9}%`;
    enemyEl.style.display = "block";
  }
  setTalkButtonVisible(false);

  applyPlayerSpriteFrame(el);
  layoutSceneWorld();
  applyPlayerTransform(el);

  function setMoveDir(dir) {
    if (dialogueActive) return; // ระหว่างคุยอยู่ ห้ามเดิน
    playerMoveDir = dir;
    if (dir !== 0) playerFacing = dir;
  }

  if (!playerControlsBound) {
    playerControlsBound = true;

    function bindHoldButton(btn, dir) {
      const start = (e) => {
        e.preventDefault();
        setMoveDir(dir);
      };
      const stop = () => {
        if (playerMoveDir === dir) setMoveDir(0);
      };
      btn.addEventListener("mousedown", start);
      btn.addEventListener("touchstart", start, { passive: false });
      btn.addEventListener("mouseup", stop);
      btn.addEventListener("mouseleave", stop);
      btn.addEventListener("touchend", stop);
      btn.addEventListener("touchcancel", stop);
    }
    bindHoldButton(leftBtn, -1);
    bindHoldButton(rightBtn, 1);

    document.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft" || e.key === "a") setMoveDir(-1);
      else if (e.key === "ArrowRight" || e.key === "d") setMoveDir(1);
    });
    document.addEventListener("keyup", (e) => {
      if ((e.key === "ArrowLeft" || e.key === "a") && playerMoveDir === -1) setMoveDir(0);
      else if ((e.key === "ArrowRight" || e.key === "d") && playerMoveDir === 1) setMoveDir(0);
    });
  }

  if (playerAnimTimer) clearInterval(playerAnimTimer);
  playerAnimTimer = setInterval(() => {
    if (playerMoveDir === 0) {
      playerWalkFrame = 0;
    } else {
      playerWalkFrame = (playerWalkFrame + 1) % DOG_SPRITE_COLS;
    }
    applyPlayerSpriteFrame(el);
  }, DOG_WALK_FRAME_MS);

  let lastTs = null;
  function tick(ts) {
    if (lastTs === null) lastTs = ts;
    const dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (playerMoveDir !== 0) {
      playerXPct += playerMoveDir * PLAYER_SPEED_PCT_PER_SEC * dt;
      // ถ้าด่านกั้นยังไม่เปิด เดินได้ไกลสุดแค่ก่อนถึงด่าน
      const maxX = barrierOpen ? PLAYER_MAX_PCT : BARRIER_X_PCT - BARRIER_STOP_MARGIN;
      playerXPct = Math.min(maxX, Math.max(PLAYER_MIN_PCT, playerXPct));
      applyPlayerTransform(el);
    }
    updateTalkPrompt();
    checkEnemyEncounter();
    playerRafId = requestAnimationFrame(tick);
  }
  if (playerRafId) cancelAnimationFrame(playerRafId);
  playerRafId = requestAnimationFrame(tick);
}
