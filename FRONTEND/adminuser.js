let currentUsers = [];

function formatDate(isoLike) {
  if (!isoLike) return "-";
  return isoLike.slice(0, 10);
}

function renderUserTable() {
  const tbody = document.getElementById("userTableBody");
  if (!currentUsers.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#999;">ไม่พบผู้ใช้</td></tr>`;
    return;
  }
  tbody.innerHTML = currentUsers
    .map(
      (u) => `
    <tr>
      <td>${escapeHtml(u.username)}</td>
      <td>${escapeHtml(u.email)}</td>
      <td>${u.coins}</td>
      <td>${u.is_admin ? "แอดมิน" : "ผู้ใช้ทั่วไป"}</td>
      <td>${escapeHtml(formatDate(u.created_at))}</td>
      <td>
        ${
          u.is_admin
            ? `<span style="color:#999;">-</span>`
            : `<button class="delete-item-btn" style="width:auto;padding:6px 14px;" onclick="deleteUser(${u.id})">ลบ</button>`
        }
      </td>
    </tr>`
    )
    .join("");
}

async function loadUsers(search = "") {
  try {
    const query = search ? `?search=${encodeURIComponent(search)}` : "";
    const { users } = await adminApiFetch(`/admin/users${query}`);
    currentUsers = users;
    renderUserTable();
  } catch (err) {
    console.error("โหลดรายชื่อผู้ใช้ไม่สำเร็จ:", err);
    alert("โหลดรายชื่อผู้ใช้ไม่สำเร็จ: " + err.message);
  }
}

async function deleteUser(id) {
  if (!confirm("ลบบัญชีผู้ใช้นี้แน่ใจไหม? ข้อมูลสัตว์เลี้ยง/ประวัติการอ่าน/ความคืบหน้าเกมของผู้ใช้คนนี้จะถูกลบไปด้วยทั้งหมด")) return;
  try {
    await adminApiFetch(`/admin/users/${id}`, { method: "DELETE" });
    await loadUsers(document.getElementById("userSearchInput").value.trim());
  } catch (err) {
    alert("ลบไม่สำเร็จ: " + err.message);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (!getAdminToken()) return;
  loadUsers();

  let debounceTimer = null;
  document.getElementById("userSearchInput").addEventListener("input", (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => loadUsers(e.target.value.trim()), 300);
  });
});
