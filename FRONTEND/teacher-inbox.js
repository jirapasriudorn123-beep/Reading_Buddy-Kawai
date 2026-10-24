// ================== กล่องข้อความจากอาจารย์ (ปุ่มจดหมายข้างกระดิ่ง) ==================
// ใช้ร่วมกันทุกหน้าที่มี .noti-icon-wrap — แทรกปุ่มจดหมายไว้ก่อนกระดิ่ง
// ข้อความมาจาก GET /api/notifications/feedback (อาจารย์เขียนในหน้ารายละเอียดผู้เรียน)
// แสดงเป็นรายการจดหมาย ใหม่สุดอยู่บน ตอบกลับได้ฉบับละครั้ง ตอบแล้วคำตอบค้างไว้ใต้ข้อความนั้น
// จุดแดงนับเฉพาะข้อความของอาจารย์ที่ยังไม่เคยเปิดอ่าน (จำ id ไว้ใน localStorage ของเครื่องนี้)

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
        <div class="inbox-head-text">
          <strong id="inboxTitle">ข้อความจากอาจารย์</strong>
          <span class="inbox-sub">ตอบกลับได้ข้อความละหนึ่งครั้ง</span>
        </div>
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
  const list = document.getElementById("inboxList");
  list.addEventListener("click", onInboxListClick);
  list.addEventListener("submit", sendReply);
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

// จดหมายหนึ่งฉบับ: วันที่ + ข้อความของอาจารย์ + คำตอบที่เคยส่ง หรือปุ่มตอบกลับถ้ายังไม่เคยตอบ
function inboxItemHtml(m, seen) {
  const isNew = !seen.has(m.id);
  const answer = m.reply
    ? `<div class="inbox-answer">
         <span class="inbox-answer-label">คำตอบของเรา · ${escapeHtml(formatInboxDate(m.reply.created_at))}</span>
         <p>${escapeHtml(m.reply.message)}</p>
       </div>`
    : `<button type="button" class="inbox-reply-btn" data-id="${m.id}">ตอบกลับ</button>
       <form class="inbox-reply-form" data-id="${m.id}" hidden>
         <textarea rows="3" maxlength="5000" placeholder="พิมพ์คำตอบถึงอาจารย์..."></textarea>
         <div class="inbox-form-actions">
           <button type="button" class="inbox-cancel" data-id="${m.id}">ยกเลิก</button>
           <button type="submit" class="inbox-send">ส่งคำตอบ</button>
         </div>
         <p class="inbox-error" hidden></p>
       </form>`;

  return `<li class="inbox-item${isNew ? " is-new" : ""}">
      <div class="inbox-when">${escapeHtml(formatInboxDate(m.created_at))}${
        isNew ? ' <span class="inbox-new">ใหม่</span>' : ""
      }</div>
      <p class="inbox-text">${escapeHtml(m.message)}</p>
      ${answer}
    </li>`;
}

function renderInboxList() {
  const seen = getInboxSeenIds();
  document.getElementById("inboxList").innerHTML = inboxMessages.length
    ? inboxMessages.map((m) => inboxItemHtml(m, seen)).join("")
    : '<li class="inbox-empty">ยังไม่มีข้อความจากอาจารย์</li>';
}

// เปิด/ปิดช่องพิมพ์ของจดหมายฉบับนั้น (ปุ่มตอบกลับ / ยกเลิก)
function onInboxListClick(e) {
  const open = e.target.closest(".inbox-reply-btn");
  const cancel = e.target.closest(".inbox-cancel");
  if (!open && !cancel) return;

  const id = (open || cancel).dataset.id;
  const form = document.querySelector(`.inbox-reply-form[data-id="${id}"]`);
  if (!form) return;
  form.hidden = !open;
  document.querySelector(`.inbox-reply-btn[data-id="${id}"]`).hidden = !!open;
  if (open) {
    form.querySelector("textarea").focus();
  } else {
    form.querySelector("textarea").value = "";
    showFormError(form, "");
  }
}

function showFormError(form, text) {
  const el = form.querySelector(".inbox-error");
  el.textContent = text;
  el.hidden = !text;
}

async function sendReply(e) {
  e.preventDefault();
  const form = e.target;
  const replyTo = Number(form.dataset.id);
  const box = form.querySelector("textarea");
  const btn = form.querySelector(".inbox-send");
  const message = box.value.trim();
  if (!message) return;

  btn.disabled = true;
  btn.textContent = "กำลังส่ง...";
  showFormError(form, "");
  try {
    const { reply } = await inboxFetch("/notifications/feedback/reply", {
      method: "POST",
      body: JSON.stringify({ message, replyTo }),
    });
    inboxMessages = inboxMessages.map((m) => (m.id === replyTo ? { ...m, reply } : m));
    renderInboxList(); // ช่องพิมพ์หายไป เหลือคำตอบที่ส่งแล้วใต้ข้อความนั้น
  } catch (err) {
    showFormError(form, err.message || "ส่งไม่สำเร็จ ลองใหม่อีกครั้งนะ");
    btn.disabled = false;
    btn.textContent = "ส่งคำตอบ";
  }
}

function openInbox() {
  renderInboxList();
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
