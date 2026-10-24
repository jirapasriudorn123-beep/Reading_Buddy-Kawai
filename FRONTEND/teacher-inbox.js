// ================== กล่องข้อความจากอาจารย์ (ปุ่มจดหมายข้างกระดิ่ง) ==================
// ใช้ร่วมกันทุกหน้าที่มี .noti-icon-wrap — แทรกปุ่มจดหมายไว้ก่อนกระดิ่ง
// ข้อความมาจาก GET /api/notifications/feedback (อาจารย์เขียนในหน้ารายละเอียดผู้เรียน)
// จุดแดงนับเฉพาะข้อความที่ยังไม่เคยเปิดอ่าน (จำ id ไว้ใน localStorage ของเครื่องนี้)

const INBOX_SEEN_KEY = "teacherInboxSeenIds";
const INBOX_SOUNDED_KEY = "teacherInboxSounded";
const INBOX_SOUND = new Audio("sound/notification.m4a");
INBOX_SOUND.preload = "auto";
INBOX_SOUND.volume = 0.5;

let inboxMessages = [];

function getInboxSeenIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(INBOX_SEEN_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function markInboxSeen() {
  try {
    localStorage.setItem(INBOX_SEEN_KEY, JSON.stringify(inboxMessages.map((m) => m.id)));
  } catch {
    /* โหมดส่วนตัว: ซ่อนจุดแดงไปก่อน แล้วค่อยนับใหม่ตอนโหลดหน้า */
  }
  const badge = document.getElementById("inboxBadge");
  if (badge) badge.hidden = true;
}

// เสียงเตือนตอนมีข้อความใหม่ — ดังครั้งเดียวต่อข้อความในรอบการใช้งานนี้
function playInboxSound(latestId) {
  let sounded = "";
  try {
    sounded = sessionStorage.getItem(INBOX_SOUNDED_KEY) || "";
  } catch {
    /* ปิด storage: ยอมให้ดังซ้ำดีกว่าไม่ดังเลย */
  }
  if (!latestId || String(latestId) === sounded) return;
  INBOX_SOUND.currentTime = 0;
  INBOX_SOUND.play()
    .then(() => {
      try {
        sessionStorage.setItem(INBOX_SOUNDED_KEY, String(latestId));
      } catch {}
    })
    .catch(() => {});
}

function buildInboxButton(bellWrap) {
  const wrap = document.createElement("div");
  wrap.className = "inbox-wrap";
  wrap.innerHTML = `
    <button type="button" class="inbox-btn" id="inboxBtn" aria-haspopup="dialog" aria-label="ข้อความจากอาจารย์">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="3" y="5.5" width="18" height="13" rx="3"/>
        <path d="M3.8 7l7.2 5.2a2 2 0 0 0 2 0L20.2 7"/>
      </svg>
      <span class="inbox-badge" id="inboxBadge" hidden>0</span>
    </button>`;
  bellWrap.parentNode.insertBefore(wrap, bellWrap);
  document.getElementById("inboxBtn").addEventListener("click", openInbox);
}

function buildInboxModal() {
  const modal = document.createElement("div");
  modal.className = "inbox-overlay";
  modal.id = "inboxModal";
  modal.innerHTML = `
    <div class="inbox-box" role="dialog" aria-modal="true" aria-labelledby="inboxTitle">
      <div class="inbox-head">
        <strong id="inboxTitle">ข้อความจากอาจารย์</strong>
        <button type="button" class="inbox-close" id="inboxClose" aria-label="ปิด">✕</button>
      </div>
      <ul class="inbox-list" id="inboxList"></ul>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById("inboxClose").addEventListener("click", closeInbox);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeInbox();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeInbox();
  });
}

function renderInboxBadge() {
  const badge = document.getElementById("inboxBadge");
  if (!badge) return;
  const seen = getInboxSeenIds();
  const unseen = inboxMessages.filter((m) => !seen.has(m.id));
  badge.hidden = unseen.length === 0;
  badge.textContent = unseen.length;
  if (unseen.length) playInboxSound(unseen[0].id);
}

function openInbox() {
  const list = document.getElementById("inboxList");
  const seen = getInboxSeenIds();
  list.innerHTML = inboxMessages.length
    ? inboxMessages
        .map(
          (m) => `<li class="${seen.has(m.id) ? "" : "is-new"}">
            <div class="inbox-when">${escapeHtml(formatInboxDate(m.created_at))}${
              seen.has(m.id) ? "" : ' <span class="inbox-new">ใหม่</span>'
            }</div>
            <p>${escapeHtml(m.message)}</p>
          </li>`
        )
        .join("")
    : '<li class="inbox-empty">ยังไม่มีข้อความจากอาจารย์</li>';
  document.getElementById("inboxModal").classList.add("open");
  markInboxSeen();
}

function closeInbox() {
  document.getElementById("inboxModal")?.classList.remove("open");
}

function formatInboxDate(sqliteDatetime) {
  if (!sqliteDatetime) return "";
  const d = new Date(sqliteDatetime.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return sqliteDatetime;
  return d.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" }) + " น.";
}

// เรียก API เอง (หน้าอื่นนอกจากหน้าอ่านไม่ได้โหลด script.js ที่มี apiFetch)
async function inboxFetch(path) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
  });
  if (!response.ok) throw new Error("โหลดข้อความไม่สำเร็จ");
  return response.json();
}

async function loadInbox() {
  try {
    const { messages } = await inboxFetch("/notifications/feedback");
    inboxMessages = messages || [];
    renderInboxBadge();
  } catch {
    /* ยังไม่ได้ล็อกอิน / เครือข่ายมีปัญหา: ไม่ต้องรบกวนผู้ใช้ */
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const bellWrap = document.querySelector(".noti-icon-wrap");
  if (!bellWrap || !localStorage.getItem("token")) return;
  buildInboxButton(bellWrap);
  buildInboxModal();
  loadInbox();
});
