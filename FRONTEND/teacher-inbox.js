// ================== กล่องข้อความจากอาจารย์ (ปุ่มจดหมายข้างกระดิ่ง) ==================
// ใช้ร่วมกันทุกหน้าที่มี .noti-icon-wrap — แทรกปุ่มจดหมายไว้ก่อนกระดิ่ง
// บทสนทนามาจาก GET /api/notifications/feedback (อาจารย์เขียนในหน้ารายละเอียดผู้เรียน)
// แสดงเป็นแชต: ข้อความอาจารย์ชิดซ้าย คำตอบของเราชิดขวา ตอบกลับได้ที่ช่องล่างสุด
// จุดแดงนับเฉพาะข้อความของอาจารย์ที่ยังไม่เคยเปิดอ่าน (จำ id ไว้ใน localStorage ของเครื่องนี้)

const INBOX_SEEN_KEY = "teacherInboxSeenIds";
const INBOX_SOUNDED_KEY = "teacherInboxSounded";
const INBOX_SOUND = new Audio("sound/notification.m4a");
INBOX_SOUND.preload = "auto";
INBOX_SOUND.volume = 0.5;

let inboxMessages = [];

// ข้อความฝั่งอาจารย์เท่านั้น (ใช้นับจุดแดง — คำตอบของเราเองไม่ต้องเตือน)
function fromTeacher() {
  return inboxMessages.filter((m) => m.sender !== "student");
}

function getInboxSeenIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(INBOX_SEEN_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function markInboxSeen() {
  try {
    localStorage.setItem(INBOX_SEEN_KEY, JSON.stringify(fromTeacher().map((m) => m.id)));
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
        <div class="inbox-head-text">
          <strong id="inboxTitle">ข้อความจากอาจารย์</strong>
          <span class="inbox-sub">คุยกับอาจารย์ได้ที่นี่</span>
        </div>
        <button type="button" class="inbox-close" id="inboxClose" aria-label="ปิด">✕</button>
      </div>
      <ul class="inbox-list" id="inboxList"></ul>
      <form class="inbox-reply" id="inboxReplyForm">
        <textarea id="inboxReplyText" rows="1" placeholder="พิมพ์ตอบกลับอาจารย์..." maxlength="5000"></textarea>
        <button type="submit" class="inbox-send" id="inboxSend" aria-label="ส่ง">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 12l16-8-6 16-2.5-6.5z"/>
          </svg>
        </button>
      </form>
      <p class="inbox-error" id="inboxError" hidden></p>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById("inboxClose").addEventListener("click", closeInbox);
  document.getElementById("inboxReplyForm").addEventListener("submit", sendReply);
  const box = document.getElementById("inboxReplyText");
  box.addEventListener("input", () => {
    box.style.height = "auto"; // ช่องพิมพ์สูงขึ้นตามข้อความ (สูงสุดกำหนดไว้ใน CSS)
    box.style.height = `${box.scrollHeight}px`;
  });
  box.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault(); // Enter = ส่ง, Shift+Enter = ขึ้นบรรทัดใหม่
      document.getElementById("inboxReplyForm").requestSubmit();
    }
  });
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
  const unseen = fromTeacher().filter((m) => !seen.has(m.id));
  badge.hidden = unseen.length === 0;
  badge.textContent = unseen.length;
  if (unseen.length) playInboxSound(unseen[0].id);
}

function renderInboxList() {
  const list = document.getElementById("inboxList");
  const seen = getInboxSeenIds();
  list.innerHTML = inboxMessages.length
    ? inboxMessages
        .map((m) => {
          const mine = m.sender === "student";
          const isNew = !mine && !seen.has(m.id);
          return `<li class="inbox-msg ${mine ? "is-mine" : "is-teacher"}${isNew ? " is-new" : ""}">
            <div class="inbox-who">${mine ? "เรา" : "อาจารย์"}${isNew ? ' <span class="inbox-new">ใหม่</span>' : ""}</div>
            <div class="inbox-bubble">${escapeHtml(m.message)}</div>
            <div class="inbox-when">${escapeHtml(formatInboxDate(m.created_at))}</div>
          </li>`;
        })
        .join("")
    : '<li class="inbox-empty">ยังไม่มีข้อความจากอาจารย์</li>';
  list.scrollTop = list.scrollHeight; // ข้อความล่าสุดอยู่ล่างสุด เปิดมาเห็นอันใหม่ก่อน
}

// ตอบกลับได้ต่อเมื่ออาจารย์เคยทักมาก่อน (หลังบ้านก็กันไว้อีกชั้น)
function updateReplyBox() {
  const canReply = fromTeacher().length > 0;
  const box = document.getElementById("inboxReplyText");
  document.getElementById("inboxReplyForm").hidden = !canReply;
  if (canReply) box.placeholder = "พิมพ์ตอบกลับอาจารย์...";
}

function openInbox() {
  renderInboxList();
  updateReplyBox();
  showInboxError("");
  document.getElementById("inboxModal").classList.add("open");
  markInboxSeen();
}

function showInboxError(text) {
  const el = document.getElementById("inboxError");
  el.textContent = text;
  el.hidden = !text;
}

async function sendReply(e) {
  e.preventDefault();
  const box = document.getElementById("inboxReplyText");
  const btn = document.getElementById("inboxSend");
  const message = box.value.trim();
  if (!message) return;

  btn.disabled = true;
  showInboxError("");
  try {
    const { reply } = await inboxFetch("/notifications/feedback/reply", {
      method: "POST",
      body: JSON.stringify({ message }),
    });
    inboxMessages = [...inboxMessages, reply];
    box.value = "";
    box.style.height = "auto";
    renderInboxList();
  } catch (err) {
    showInboxError(err.message || "ส่งไม่สำเร็จ ลองใหม่อีกครั้งนะ");
  } finally {
    btn.disabled = false;
    box.focus();
  }
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
async function inboxFetch(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "ทำรายการไม่สำเร็จ");
  return data;
}

async function loadInbox() {
  try {
    const { messages } = await inboxFetch("/notifications/feedback");
    inboxMessages = messages || [];
    renderInboxBadge();
    if (document.getElementById("inboxModal")?.classList.contains("open")) renderInboxList();
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
