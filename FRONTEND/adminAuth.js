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
