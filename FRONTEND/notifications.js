// ================== ระบบแจ้งเตือน (กระดิ่ง) ==================
// ใช้ร่วมกันทุกหน้าที่มี .noti-icon-wrap — ดึงแจ้งเตือนจริงจาก backend 3 แบบ:
// 1) เว็บมีอัปเดตใหม่  2) สถานะน้องหมาต่ำกว่า 25%  3) ประวัติการซื้อของล่าสุด
//
// จุดแดง (badge) นับเฉพาะแจ้งเตือนที่ "ยังไม่เคยเห็น" (เทียบจาก id กับที่เก็บไว้ใน localStorage)
// พอกดเปิดกระดิ่งดูแล้ว จุดแดงจะหายไปทันที เพราะ id ที่เห็นแล้วทั้งหมดจะถูกจำไว้ไม่ให้นับซ้ำอีก

const NOTI_TYPE_ICON = { update: "🔔", pet_low: "🐶", purchase: "🛍️" };
const NOTI_SEEN_KEY = "notiSeenIds";

function getSeenNotiIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(NOTI_SEEN_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function markNotiIdsSeen(ids) {
  const seen = getSeenNotiIds();
  ids.forEach((id) => seen.add(id));
  localStorage.setItem(NOTI_SEEN_KEY, JSON.stringify([...seen]));
}

function countUnseenNotis(notifications) {
  const seen = getSeenNotiIds();
  return notifications.filter((n) => !seen.has(n.id)).length;
}

async function notiApiFetch(path, options = {}) {
  const token = localStorage.getItem("token");
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  if (!response.ok) throw new Error("โหลดแจ้งเตือนไม่สำเร็จ");
  return response.json();
}

function notiTimeAgo(dateStr) {
  if (!dateStr) return "";
  const then = new Date(`${dateStr.replace(" ", "T")}Z`).getTime();
  const diffMin = Math.max(0, Math.floor((Date.now() - then) / 60000));
  if (diffMin < 1) return "เมื่อสักครู่";
  if (diffMin < 60) return `${diffMin} นาทีที่แล้ว`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} ชั่วโมงที่แล้ว`;
  return `${Math.floor(diffHour / 24)} วันที่แล้ว`;
}

function renderNotiList(panel, notifications) {
  if (!notifications.length) {
    panel.innerHTML =
      '<div class="noti-dropdown-title">การแจ้งเตือน</div><div class="noti-empty">ยังไม่มีการแจ้งเตือนตอนนี้</div>';
    return;
  }
  const items = notifications
    .map(
      (n) => `
      <div class="noti-item">
        <span class="noti-item-icon">${NOTI_TYPE_ICON[n.type] || "🔔"}</span>
        <div class="noti-item-text">
          ${n.message}
          ${n.createdAt ? `<div class="noti-item-time">${notiTimeAgo(n.createdAt)}</div>` : ""}
        </div>
      </div>`
    )
    .join("");
  panel.innerHTML = `<div class="noti-dropdown-title">การแจ้งเตือน</div>${items}`;
}

function updateBadge(badge, notifications) {
  if (!badge) return;
  const unseenCount = countUnseenNotis(notifications);
  if (unseenCount > 0) {
    badge.textContent = unseenCount > 9 ? "9+" : unseenCount;
    badge.style.display = "flex";
  } else {
    badge.style.display = "none";
  }
}

async function loadNotifications(panel, badge) {
  try {
    const data = await notiApiFetch("/notifications");
    renderNotiList(panel, data.notifications);
    updateBadge(badge, data.notifications);
    return data.notifications;
  } catch (err) {
    console.error("โหลดแจ้งเตือนไม่สำเร็จ:", err);
    return [];
  }
}

function setupNotifications() {
  const wrap = document.querySelector(".noti-icon-wrap");
  if (!wrap || !localStorage.getItem("token")) return;

  const badge = wrap.querySelector(".noti-badge");
  const panel = document.createElement("div");
  panel.className = "noti-dropdown";
  wrap.appendChild(panel);

  loadNotifications(panel, badge);
  // เช็คแจ้งเตือนใหม่ทุก 60 วิ เผื่อสถานะน้องหมาตกลงมาต่ำกว่า 25% ระหว่างเปิดหน้าค้างไว้
  setInterval(() => loadNotifications(panel, badge), 60000);

  wrap.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (panel.classList.contains("open")) {
      panel.classList.remove("open");
      return;
    }
    panel.classList.add("open");
    // ซ่อนจุดแดงทันทีตอนกดเปิดดู ไม่ต้องรอโหลดเสร็จก่อน
    if (badge) badge.style.display = "none";

    const notifications = await loadNotifications(panel, badge);
    markNotiIdsSeen(notifications.map((n) => n.id));
    updateBadge(badge, notifications); // นับใหม่หลัง mark seen แล้ว (ควรเหลือ 0)

    const hasUpdate = notifications.some((n) => n.type === "update");
    if (hasUpdate) {
      try {
        await notiApiFetch("/notifications/mark-update-seen", { method: "POST" });
      } catch (err) {
        console.error("mark-update-seen ไม่สำเร็จ:", err);
      }
    }
  });

  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target)) panel.classList.remove("open");
  });
}

document.addEventListener("DOMContentLoaded", setupNotifications);
