// ================== จัดการคูปอง: ร้านค้าที่ร่วมรายการ (PIN) + รายงานคูปองที่แลกแล้ว ==================

let shops = [];
let coupons = [];
let couponFilter = "all";
let editingShopId = null;

const COUPON_STATUS_LABEL = { active: "ใช้ได้", used: "ใช้แล้ว", expired: "หมดอายุ" };

// เวลาจาก backend เป็น UTC แบบ SQLite → แสดงเป็นเวลาไทย
function formatThaiDateTime(sqliteDatetime) {
  if (!sqliteDatetime) return "-";
  return new Date(sqliteDatetime.replace(" ", "T") + "Z").toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// ─── ร้านค้า ───────────────────────────────────────────────────
async function loadShops() {
  try {
    ({ shops } = await adminApiFetch("/admin/shops"));
    renderShops();
  } catch (err) {
    alert("โหลดร้านค้าไม่สำเร็จ: " + err.message);
  }
}

function renderShops() {
  const body = document.getElementById("shopTableBody");
  if (!shops.length) {
    body.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#999;">ยังไม่มีร้านค้า</td></tr>`;
    return;
  }
  const now = new Date();
  body.innerHTML = shops
    .map((s) => {
      const locked = s.lockedUntil && new Date(s.lockedUntil.replace(" ", "T") + "Z") > now;
      const pin = !s.hasPin
        ? `<span class="coupon-pill no-pin">ยังไม่ตั้ง PIN</span>`
        : locked
        ? `<span class="coupon-pill expired">ล็อก (PIN ผิดหลายครั้ง)</span>`
        : `<span class="coupon-pill active">ตั้งแล้ว</span>`;
      return `
      <tr>
        <td>${escapeHtml(s.name)}</td>
        <td>${pin}</td>
        <td>${s.usedCount} ใบ</td>
        <td>
          <div class="shop-actions">
            <button class="action-btn pencil-btn" onclick="openShopModal(${s.id})" title="แก้ไข / ตั้ง PIN" aria-label="แก้ไข / ตั้ง PIN">
              <svg viewBox="0 0 24 24" fill="none" stroke="#f0b23d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            </button>
            <button class="action-btn delete-btn" onclick="deleteShop(${s.id})" title="ลบ" aria-label="ลบ">
              <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7"/><path d="M6 7l1 12.5A2 2 0 0 0 9 21h6a2 2 0 0 0 2-1.5L18 7"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
            </button>
          </div>
        </td>
      </tr>`;
    })
    .join("");
}

function openShopModal(id = null) {
  editingShopId = id;
  const shop = shops.find((s) => s.id === id);
  document.getElementById("shopModalTitle").textContent = shop ? "แก้ไขร้านค้า" : "เพิ่มร้านค้า";
  document.getElementById("shopNameInput").value = shop ? shop.name : "";
  document.getElementById("shopPinInput").value = "";
  document.getElementById("shopPinInput").placeholder = shop && shop.hasPin ? "เว้นว่าง = ไม่เปลี่ยน PIN" : "เช่น 4821";
  document.getElementById("shopModal").classList.add("active");
}

function closeShopModal() {
  document.getElementById("shopModal").classList.remove("active");
}

async function saveShop() {
  const name = document.getElementById("shopNameInput").value.trim();
  const pin = document.getElementById("shopPinInput").value.trim();
  if (!name) {
    alert("กรุณากรอกชื่อร้าน");
    return;
  }
  if (pin && !/^\d{4,8}$/.test(pin)) {
    alert("PIN ต้องเป็นตัวเลข 4-8 หลัก");
    return;
  }

  const btn = document.getElementById("shopSaveBtn");
  btn.disabled = true;
  try {
    if (editingShopId) {
      await adminApiFetch(`/admin/shops/${editingShopId}`, { method: "PUT", body: JSON.stringify({ name, pin }) });
    } else {
      await adminApiFetch("/admin/shops", { method: "POST", body: JSON.stringify({ name, pin }) });
    }
    closeShopModal();
    await loadShops();
  } catch (err) {
    alert("บันทึกไม่สำเร็จ: " + err.message);
  } finally {
    btn.disabled = false;
  }
}

async function deleteShop(id) {
  const shop = shops.find((s) => s.id === id);
  if (!shop || !confirm(`ลบร้าน "${shop.name}" แน่ใจไหม? ร้านนี้จะยืนยันคูปองไม่ได้อีก`)) return;
  try {
    await adminApiFetch(`/admin/shops/${id}`, { method: "DELETE" });
    await loadShops();
  } catch (err) {
    alert("ลบไม่สำเร็จ: " + err.message);
  }
}

// ─── รายงานคูปอง ───────────────────────────────────────────────
async function loadCoupons() {
  try {
    ({ coupons } = await adminApiFetch("/admin/coupons"));
    renderCoupons();
  } catch (err) {
    alert("โหลดรายงานคูปองไม่สำเร็จ: " + err.message);
  }
}

function setCouponFilter(status) {
  couponFilter = status;
  document.querySelectorAll("#couponFilters .coupon-filter").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.status === status);
  });
  renderCoupons();
}

function renderCoupons() {
  const count = (status) => coupons.filter((c) => c.status === status).length;
  const usedBaht = coupons.filter((c) => c.status === "used").reduce((sum, c) => sum + c.discountBaht, 0);
  document.getElementById("couponSummary").textContent =
    `แลกแล้ว ${coupons.length} ใบ · ใช้ได้ ${count("active")} · ใช้แล้ว ${count("used")} (ส่วนลดรวม ${usedBaht} บาท) · หมดอายุ ${count("expired")}`;

  const list = couponFilter === "all" ? coupons : coupons.filter((c) => c.status === couponFilter);
  const body = document.getElementById("couponTableBody");
  if (!list.length) {
    body.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#999;">ไม่มีคูปอง</td></tr>`;
    return;
  }
  body.innerHTML = list
    .map(
      (c) => `
      <tr>
        <td class="coupon-code">${escapeHtml(c.code)}</td>
        <td>${escapeHtml(c.username || "(ลบบัญชีแล้ว)")}</td>
        <td>${escapeHtml(c.name)}<br><small>ส่วนลด ${c.discountBaht} บาท · ${c.priceCoins} คอยน์</small></td>
        <td><span class="coupon-pill ${c.status}">${COUPON_STATUS_LABEL[c.status] || c.status}</span></td>
        <td>${escapeHtml(formatThaiDateTime(c.createdAt))}</td>
        <td>${escapeHtml(formatThaiDateTime(c.expiresAt))}</td>
        <td>${c.status === "used" ? `${escapeHtml(c.usedShop || "-")}<br><small>${escapeHtml(formatThaiDateTime(c.usedAt))}</small>` : "-"}</td>
      </tr>`
    )
    .join("");
}

document.addEventListener("DOMContentLoaded", () => {
  if (!getAdminToken()) return; // adminAuth.js จะเด้งไป login ให้แล้ว
  loadShops();
  loadCoupons();

  document.getElementById("shopModal").addEventListener("click", function (e) {
    if (e.target === this) closeShopModal();
  });
});
