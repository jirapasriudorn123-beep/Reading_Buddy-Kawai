// ================== ตัวช่วยเรียก API ==================

function getToken() {
  return localStorage.getItem("token");
}

// URL รากของ backend (ไม่มี /api ต่อท้าย) ใช้สร้าง URL เต็มของรูปที่อัปโหลดไว้
const UPLOADS_BASE_URL = API_BASE_URL.replace(/\/api\/?$/, "");

async function apiFetch(path, options = {}) {
  const token = getToken();
  const isFormData = options.body instanceof FormData;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      // ถ้าเป็น FormData ห้ามตั้ง Content-Type เอง ต้องปล่อยให้ browser ใส่ boundary ให้อัตโนมัติ
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
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

// ================== เริ่มทำงานเมื่อโหลดหน้า ==================

document.addEventListener("DOMContentLoaded", async () => {
  if (!getToken()) {
    window.location.href = "login.html";
    return;
  }

  setupSidebarToggle();

  const aboutModal = document.getElementById("aboutModal");
  if (aboutModal) {
    aboutModal.addEventListener("click", (e) => {
      if (e.target === aboutModal) closeAboutModal();
    });
  }

  try {
    await loadUserProfile();
  } catch (err) {
    console.error("โหลดข้อมูลโปรไฟล์ไม่สำเร็จ:", err);
  }
});

// ================== โหลดข้อมูลผู้ใช้จริงจาก backend ==================

async function loadUserProfile() {
  const { user } = await apiFetch("/auth/me");

  const nameElement = document.getElementById("displayUserName");
  if (nameElement) nameElement.innerText = user.username;

  const emailElement = document.getElementById("displayUserEmail");
  if (emailElement) emailElement.innerText = user.email;

  const coinElement = document.getElementById("coinAmount");
  if (coinElement) coinElement.textContent = user.coins;

  // แสดงรูปโปรไฟล์จริงจาก backend (ถ้าเคยอัปโหลดไว้)
  // Cloudinary URL เริ่มด้วย https:// ใช้ตรงได้เลย; ของเก่าที่เก็บเป็น /uploads/... ต้อง prefix backend
  const avatarEl = document.getElementById("userAvatar");
  if (avatarEl && user.avatarUrl) {
    avatarEl.src = user.avatarUrl.startsWith("http")
      ? user.avatarUrl
      : `${UPLOADS_BASE_URL}${user.avatarUrl}`;
  }
}

// ================== รูปโปรไฟล์ (อัปโหลดขึ้น backend จริง) ==================

async function uploadImage(event) {
  const file = event.target.files[0];
  if (!file) return;

  // แสดง preview ทันทีระหว่างรออัปโหลด (ยังไม่ใช่รูปจริงที่บันทึกแล้ว)
  const avatarEl = document.getElementById("userAvatar");
  let previewUrl = null;
  if (avatarEl) {
    previewUrl = URL.createObjectURL(file);
    avatarEl.src = previewUrl;
  }

  const formData = new FormData();
  formData.append("avatar", file);

  try {
    const result = await apiFetch("/auth/avatar", {
      method: "POST",
      body: formData,
    });

    if (avatarEl) {
      // เติม timestamp ต่อท้าย กัน browser cache รูปเก่าไว้ไม่ยอมโหลดรูปใหม่
      const fullUrl = result.avatarUrl.startsWith("http")
        ? result.avatarUrl
        : `${UPLOADS_BASE_URL}${result.avatarUrl}`;
      avatarEl.src = `${fullUrl}?t=${Date.now()}`;
    }
    alert("อัปเดตรูปโปรไฟล์เรียบร้อย!");
  } catch (err) {
    alert("❌ อัปโหลดรูปไม่สำเร็จ: " + err.message);
    // อัปโหลดไม่สำเร็จ ให้โหลดข้อมูลเดิมกลับมาแสดงแทน preview ที่ผิดพลาด
    loadUserProfile().catch(() => {});
  } finally {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }
}

// ================== แก้ไขโปรไฟล์ (เปลี่ยนชื่อผู้ใช้จริงผ่าน backend) ==================

async function editProfile() {
  const newName = prompt("กรุณาใส่ชื่อใหม่ของคุณ:");
  if (!newName || !newName.trim()) return;

  try {
    const result = await apiFetch("/auth/username", {
      method: "PUT",
      body: JSON.stringify({ username: newName.trim() }),
    });

    const nameElement = document.getElementById("displayUserName");
    if (nameElement) nameElement.innerText = result.username;

    localStorage.setItem("currentUser", result.username);
    alert("แก้ไขชื่อผู้ใช้สำเร็จ!");
  } catch (err) {
    alert("❌ " + err.message);
  }
}

// ================== เปลี่ยนรหัสผ่าน (ต้องกรอกรหัสผ่านเดิมก่อน) ==================

async function changePassword() {
  const currentPassword = prompt("กรุณากรอกรหัสผ่านปัจจุบัน:");
  if (!currentPassword) return;

  const newPassword = prompt("กรุณากรอกรหัสผ่านใหม่ (อย่างน้อย 6 ตัวอักษร):");
  if (!newPassword) return;

  const confirmPassword = prompt("กรุณายืนยันรหัสผ่านใหม่อีกครั้ง:");
  if (!confirmPassword) return;

  try {
    await apiFetch("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
    });
    alert("เปลี่ยนรหัสผ่านสำเร็จ! กรุณาเข้าสู่ระบบใหม่อีกครั้ง");
    localStorage.removeItem("token");
    localStorage.removeItem("currentUser");
    window.location.href = "login.html";
  } catch (err) {
    alert("❌ " + err.message);
  }
}

// ================== เกี่ยวกับเรา ==================

function showAboutModal() {
  const modal = document.getElementById("aboutModal");
  if (modal) modal.style.display = "flex";
}

function closeAboutModal() {
  const modal = document.getElementById("aboutModal");
  if (modal) modal.style.display = "none";
}

// ================== Sidebar toggle ==================

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

// ================== Sign out จริง (ล้าง token จริง ไม่ใช่แค่ isLoggedIn) ==================

function signOut(event) {
  if (event) event.preventDefault();

  const confirmLogout = confirm("คุณต้องการออกจากระบบใช่หรือไม่?");
  if (!confirmLogout) return;

  localStorage.removeItem("token");
  localStorage.removeItem("currentUser");
  localStorage.removeItem("isLoggedIn"); // เผื่อของเก่าหลงเหลืออยู่

  alert("ออกจากระบบเรียบร้อยแล้ว");
  window.location.href = "login.html";
}
