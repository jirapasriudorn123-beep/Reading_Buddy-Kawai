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
            : `<button class="coin-adjust-btn" onclick="openCoinModal(${u.id})">🪙 ปรับคอยน์</button>
               <button class="delete-item-btn" style="width:auto;padding:6px 14px;" onclick="deleteUser(${u.id})">ลบ</button>`
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

// ================== ปรับคอยน์ (เพิ่ม/หัก พร้อมเหตุผล ระบบเก็บประวัติไว้) ==================
let coinUserId = null;

// เวลาจาก backend เป็น UTC แบบ SQLite → แสดงเป็นเวลาไทย
function formatThaiDateTime(sqliteDatetime) {
  if (!sqliteDatetime) return "-";
  return new Date(sqliteDatetime.replace(" ", "T") + "Z").toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function renderCoinHistory(history) {
  const box = document.getElementById("coinHistory");
  if (!history.length) {
    box.innerHTML = `<p class="coin-history-empty">ยังไม่เคยปรับคอยน์</p>`;
    return;
  }
  box.innerHTML = history
    .map(
      (h) => `
      <div class="coin-history-row">
        <span class="${h.amount > 0 ? "coin-plus" : "coin-minus"}">${h.amount > 0 ? "+" : ""}${h.amount}</span>
        <span>${escapeHtml(h.reason)}<br><small>${escapeHtml(formatThaiDateTime(h.createdAt))} · โดย ${escapeHtml(h.adminName || "-")} · คงเหลือ ${h.balanceAfter}</small></span>
      </div>`
    )
    .join("");
}

async function openCoinModal(id) {
  coinUserId = id;
  document.getElementById("coinAmountInput").value = "";
  document.getElementById("coinReasonInput").value = "";
  document.getElementById("coinHistory").innerHTML = "";
  document.getElementById("coinModal").classList.add("active");
  try {
    const { user, history } = await adminApiFetch(`/admin/users/${id}/coins`);
    document.getElementById("coinModalTitle").textContent = `ปรับคอยน์: ${user.username}`;
    document.getElementById("coinCurrent").textContent = user.coins.toLocaleString();
    renderCoinHistory(history);
  } catch (err) {
    alert("โหลดข้อมูลคอยน์ไม่สำเร็จ: " + err.message);
  }
}

function closeCoinModal() {
  document.getElementById("coinModal").classList.remove("active");
}

function setCoinAmount(amount) {
  document.getElementById("coinAmountInput").value = amount;
}

async function saveCoinAdjust() {
  const amount = Number(document.getElementById("coinAmountInput").value);
  const reason = document.getElementById("coinReasonInput").value.trim();
  if (!Number.isInteger(amount) || amount === 0) {
    alert("กรุณาใส่จำนวนคอยน์เป็นจำนวนเต็มที่ไม่ใช่ 0");
    return;
  }
  if (!reason) {
    alert("กรุณาระบุเหตุผล");
    return;
  }

  const btn = document.getElementById("coinSaveBtn");
  btn.disabled = true;
  try {
    const result = await adminApiFetch(`/admin/users/${coinUserId}/coins`, {
      method: "POST",
      body: JSON.stringify({ amount, reason }),
    });
    alert("✅ " + result.message);
    await openCoinModal(coinUserId); // รีเฟรชยอดและประวัติในหน้าต่าง
    await loadUsers(document.getElementById("userSearchInput").value.trim());
  } catch (err) {
    alert("ปรับคอยน์ไม่สำเร็จ: " + err.message);
  } finally {
    btn.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (!getAdminToken()) return;
  loadUsers();

  document.getElementById("coinModal").addEventListener("click", function (e) {
    if (e.target === this) closeCoinModal();
  });

  let debounceTimer = null;
  document.getElementById("userSearchInput").addEventListener("input", (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => loadUsers(e.target.value.trim()), 300);
  });
});
