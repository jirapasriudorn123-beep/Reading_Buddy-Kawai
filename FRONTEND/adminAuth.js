// ================== ใช้ร่วมกันทุกหน้าแอดมิน ==================
// แอดมิน login ที่หน้า login.html เดียวกับ user ทั่วไป (login.html จะเช็ค isAdmin แล้วเด้งมาที่ adminhome.html เอง)
// เช็คว่ามี token แอดมินไหม ถ้าไม่มีเด้งกลับไป login.html, ผูกปุ่ม sign out / ย่อ sidebar, และมี adminApiFetch ให้เรียก API แบบใส่ token อัตโนมัติ

// escapeHtml อยู่ใน config.js (โหลดก่อนไฟล์นี้เสมอทุกหน้าแอดมิน) ใช้ร่วมกับหน้า user ได้

function getAdminToken() {
  return localStorage.getItem("adminToken");
}

function getAdminUser() {
  try {
    return JSON.parse(localStorage.getItem("adminUser") || "null");
  } catch {
    return null;
  }
}

function clearAdminSession() {
  localStorage.removeItem("adminToken");
  localStorage.removeItem("adminUser");
}

async function adminApiFetch(path, options = {}) {
  const token = getAdminToken();
  const isFormData = options.body instanceof FormData;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

  if (response.status === 401 || response.status === 403) {
    clearAdminSession();
    window.location.href = "login.html";
    throw new Error("ไม่มีสิทธิ์เข้าถึง กรุณาเข้าสู่ระบบแอดมินใหม่");
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data.message || "เกิดข้อผิดพลาด");
    err.data = data;
    throw err;
  }
  return data;
}

// ---------- กล่องยืนยันก่อนลบ (ใช้แทน confirm() ของเบราว์เซอร์) ----------
// const ok = await adminConfirm("ลบสินค้านี้แน่ใจไหม?") → true เมื่อกด "ยืนยัน", false เมื่อกด "ยกเลิก" / Esc / คลิกนอกกล่อง
function adminConfirm(message, { title = "ยืนยันการลบ", confirmText = "ยืนยัน", cancelText = "ยกเลิก" } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    overlay.innerHTML = `<div class="confirm-box" role="alertdialog" aria-modal="true" aria-labelledby="confirmTitle" aria-describedby="confirmMessage">
        <div class="confirm-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7"/><path d="M6 7l1 12.5A2 2 0 0 0 9 21h6a2 2 0 0 0 2-1.5L18 7"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
        </div>
        <h3 id="confirmTitle">${escapeHtml(title)}</h3>
        <p id="confirmMessage">${escapeHtml(message)}</p>
        <div class="confirm-actions">
          <button type="button" class="confirm-cancel">${escapeHtml(cancelText)}</button>
          <button type="button" class="confirm-ok">${escapeHtml(confirmText)}</button>
        </div>
      </div>`;

    const close = (result) => {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      resolve(result);
    };
    const onKey = (e) => {
      if (e.key === "Escape") close(false);
    };
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close(false);
    });
    overlay.querySelector(".confirm-cancel").addEventListener("click", () => close(false));
    overlay.querySelector(".confirm-ok").addEventListener("click", () => close(true));
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
    overlay.querySelector(".confirm-cancel").focus(); // ปุ่มที่โฟกัสก่อนคือ "ยกเลิก" กดผิดก็ไม่ลบ
  });
}

function requireAdminSession() {
  if (!getAdminToken()) {
    window.location.href = "login.html";
    return false;
  }
  return true;
}

function setupAdminChrome() {
  const toggleBtn = document.getElementById("toggleBtn");
  const sidebar = document.querySelector(".sidebar");
  if (toggleBtn && sidebar) {
    if (localStorage.getItem("adminSidebarCollapsed") === "1") {
      sidebar.classList.add("icon-collapsed");
    }
    toggleBtn.onclick = (e) => {
      e.stopPropagation();
      sidebar.classList.toggle("icon-collapsed");
      localStorage.setItem("adminSidebarCollapsed", sidebar.classList.contains("icon-collapsed") ? "1" : "0");
    };
  }

  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", (e) => {
      e.preventDefault();
      clearAdminSession();
      window.location.href = "login.html";
    });
  }

  const nameDisplay = document.getElementById("adminNameDisplay");
  if (nameDisplay) {
    const admin = getAdminUser();
    nameDisplay.textContent = admin?.username || "ผู้ดูแลระบบ";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (!requireAdminSession()) return;
  setupAdminChrome();
});
