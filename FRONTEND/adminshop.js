let currentProducts = [];
let currentCategory = "ทั้งหมด";
let editingProductId = null; // null = โหมดเพิ่มสินค้าใหม่
let selectedProductFile = null;

// ─── LOAD ─────────────────────────────────────────────────────
async function loadProducts() {
  try {
    const { products } = await adminApiFetch("/admin/products");
    currentProducts = products;
    updateGrid();
  } catch (err) {
    console.error("โหลดรายการสินค้าไม่สำเร็จ:", err);
    alert("โหลดรายการสินค้าไม่สำเร็จ: " + err.message);
  }
}

// ป้ายบอกว่าไอเทมนี้ใช้กับน้องหมายังไง (ต้องตรงกับ PET_ACTIONS ใน BACKEND/src/routes/admin.js)
const PET_ACTION_LABEL = {
  feed: "🍽️ ให้อาหาร",
  bath: "🛁 อาบน้ำ",
  happiness: "😊 เล่นด้วย",
  sleep: "😴 พักผ่อน",
};

const PET_BREED_LABEL = {
  golden: "โกลเด้น",
  shiba: "ชิบะ",
  siberian: "ไซบีเรียนฮัสกี้",
  thairidgeback: "ไทยหลังอาน",
};

// ─── RENDER ───────────────────────────────────────────────────
// URL รากของ backend (ไม่มี /api ต่อท้าย) ใช้สร้าง URL เต็มของรูปสินค้าที่อัปโหลดไว้
const UPLOADS_BASE_URL = API_BASE_URL.replace(/\/api\/?$/, "");

// สินค้าที่ seed ไว้เก็บ img เป็นชื่อไฟล์ในโฟลเดอร์ img/ ของ frontend
// ส่วนสินค้าที่อัปโหลดเองเก็บเป็น path ของ backend (/uploads/products/xxx.png) ต้องเติม origin ของ backend ให้ด้วย
// ไม่งั้นเบราว์เซอร์จะไปหาที่ origin ของ frontend (เช่น :5500) ซึ่งไม่มีไฟล์นั้นอยู่
function resolveProductImg(img) {
  if (!img) return "";
  if (img.startsWith("http")) return img;
  if (img.startsWith("/")) return `${UPLOADS_BASE_URL}${img}`;
  return `img/${img}`;
}

function renderProducts(items) {
  const grid = document.getElementById("productGrid");
  if (!grid) return;
  if (!items.length) {
    grid.innerHTML = `<p style="grid-column:1/-1;text-align:center;color:#999;">ไม่มีสินค้าในหมวดนี้</p>`;
    return;
  }
  grid.innerHTML = items
    .map((p) => {
      const tagHTML = p.tag ? `<span class="product-tag">${escapeHtml(p.tag)}</span>` : "";
      const petUseHTML = p.pet_breed
        ? `<p class="pet-use-note">🐶 น้องหมาตัวใหม่ · ${PET_BREED_LABEL[p.pet_breed] || p.pet_breed}</p>`
        : p.pet_action
        ? `<p class="pet-use-note">${PET_ACTION_LABEL[p.pet_action]} +${p.stat_gain}%</p>`
        : `<p class="pet-use-note muted">ของสะสม (ใช้กับน้องไม่ได้)</p>`;
      const safeName = escapeHtml(p.name);
      const safeId = escapeHtml(p.id);
      // คูปองที่ยังไม่ตั้งมูลค่า (และใช้กับน้องหมาไม่ได้) ผู้ใช้แลกไม่ได้ — เตือนให้แอดมินเห็น
      const couponNote =
        p.category === "คูปอง" && !p.pet_action
          ? p.discount_baht > 0
            ? `<p class="pet-use-note">🎫 ส่วนลด ${p.discount_baht} บาท · ผ่านแบบทดสอบ ${p.required_post_chapters || 0} บท · ผ่านเกม ${p.required_game_worlds || 0} โลก</p>`
            : `<p class="pet-use-note coupon-unset">⚠️ ยังไม่ได้ตั้งมูลค่าส่วนลด — ผู้ใช้แลกไม่ได้</p>`
          : "";
      return `
            <div class="product-card">
                ${tagHTML}
                <p><strong>${safeName}</strong></p>
                ${couponNote || petUseHTML}
                <img src="${escapeHtml(resolveProductImg(p.img))}" width="100" alt="${safeName}" onerror="this.src='img/placeholder.png'">
                <button class="price-btn"><img src="img/coin_ja.png" alt="เหรียญ" class="price-coin-icon">${p.price}</button>
                <div class="admin-card-actions">
                    <button class="action-btn pencil-btn" onclick="openEditModal('${safeId}')" title="แก้ไข" aria-label="แก้ไข"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>
                    <button class="action-btn delete-btn" onclick="deleteProduct('${safeId}')" title="ลบ" aria-label="ลบ"><svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7"/><path d="M6 7l1 12.5A2 2 0 0 0 9 21h6a2 2 0 0 0 2-1.5L18 7"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>
                </div>
            </div>
        `;
    })
    .join("");
}

// ─── FILTER / SEARCH ──────────────────────────────────────────
function getFilteredProducts() {
  let list =
    currentCategory === "ทั้งหมด" ? currentProducts : currentProducts.filter((p) => p.category === currentCategory);
  const term = (document.getElementById("searchInput")?.value || "").trim().toLowerCase();
  if (term) list = list.filter((p) => p.name.toLowerCase().includes(term));
  return list;
}

function updateGrid() {
  renderProducts(getFilteredProducts());
}

function filterItems(categoryName) {
  currentCategory = categoryName;
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.innerText === categoryName);
  });
  updateGrid();
}

function searchProduct() {
  updateGrid();
}

// ─── ADD / EDIT MODAL ─────────────────────────────────────────
// ช่อง "เติมให้กี่ %" มีความหมายเฉพาะตอนที่ไอเทมใช้กับน้องหมาได้ ถ้าเป็นของสะสมก็ซ่อนไปเลย
function togglePetGainField() {
  const petAction = document.getElementById("editItemPetAction").value;
  const gainGroup = document.getElementById("petGainGroup");
  if (gainGroup) gainGroup.style.display = petAction ? "" : "none";
}

function toggleCouponFields() {
  const category = document.getElementById("editItemCategory").value;
  document.getElementById("couponFieldsRow").style.display = category === "คูปอง" ? "" : "none";
  document.getElementById("petBreedGroup").style.display = category === "สัตว์เลี้ยง" ? "" : "none";
}

function resetModalFields() {
  document.getElementById("editItemId").value = "";
  document.getElementById("editItemName").value = "";
  document.getElementById("editItemDesc").value = "";
  document.getElementById("editItemPrice").value = "";
  document.getElementById("editItemCategory").value = "อาหาร";
  document.getElementById("editItemPetAction").value = "";
  document.getElementById("editItemStatGain").value = "";
  document.getElementById("editItemDiscount").value = "";
  document.getElementById("editItemReqChapters").value = "";
  document.getElementById("editItemReqWorlds").value = "";
  document.getElementById("editItemPetBreed").value = "";
  togglePetGainField();
  toggleCouponFields();

  const preview = document.getElementById("editImgPreview");
  preview.src = "";
  preview.style.opacity = "0.3";

  document.getElementById("editFileName").textContent = "เลือกรูป...";
  document.getElementById("editFileInput").value = "";
  selectedProductFile = null;
}

function openAddModal() {
  editingProductId = null;
  resetModalFields();
  document.querySelector(".edit-modal-title").textContent = "เพิ่มสินค้า";
  document.getElementById("editItemModal").classList.add("active");
}

function openEditModal(id) {
  const product = currentProducts.find((p) => p.id === id);
  if (!product) return;

  editingProductId = id;
  selectedProductFile = null;

  document.getElementById("editItemId").value = product.id;
  document.getElementById("editItemName").value = product.name;
  document.getElementById("editItemDesc").value = product.description || "";
  document.getElementById("editItemPrice").value = product.price || "";
  document.getElementById("editItemCategory").value = product.category;
  document.getElementById("editItemPetAction").value = product.pet_action || "";
  document.getElementById("editItemStatGain").value = product.stat_gain || "";
  document.getElementById("editItemDiscount").value = product.discount_baht || "";
  document.getElementById("editItemReqChapters").value = product.required_post_chapters || "";
  document.getElementById("editItemReqWorlds").value = product.required_game_worlds || "";
  document.getElementById("editItemPetBreed").value = product.pet_breed || "";
  togglePetGainField();
  toggleCouponFields();

  const preview = document.getElementById("editImgPreview");
  preview.src = resolveProductImg(product.img);
  preview.style.opacity = product.img ? "1" : "0.3";

  document.getElementById("editFileName").textContent = "เลือกรูป...";
  document.getElementById("editFileInput").value = "";

  document.querySelector(".edit-modal-title").textContent = "แก้ไขสินค้า";
  document.getElementById("editItemModal").classList.add("active");
}

function closeEditModal() {
  document.getElementById("editItemModal").classList.remove("active");
}

function handleEditFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  selectedProductFile = file;
  document.getElementById("editFileName").textContent = file.name;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const preview = document.getElementById("editImgPreview");
    preview.src = ev.target.result;
    preview.style.opacity = "1";
  };
  reader.readAsDataURL(file);
}

async function saveItemEdit() {
  const name = document.getElementById("editItemName").value.trim();
  const desc = document.getElementById("editItemDesc").value.trim();
  const price = Number(document.getElementById("editItemPrice").value);
  const category = document.getElementById("editItemCategory").value;
  const petAction = document.getElementById("editItemPetAction").value;
  const statGain = document.getElementById("editItemStatGain").value;

  if (!name) {
    alert("กรุณากรอกชื่อไอเทม");
    return;
  }
  if (Number.isNaN(price) || price < 0) {
    alert("ราคาต้องไม่ติดลบ");
    return;
  }
  if (
    category === "คูปอง" &&
    !petAction &&
    !(Number(document.getElementById("editItemDiscount").value) > 0) &&
    !confirm("ยังไม่ได้ใส่มูลค่าส่วนลด (บาท) — ผู้ใช้จะแลกคูปองนี้ไม่ได้จนกว่าจะใส่ บันทึกต่อไหม?")
  ) {
    return;
  }
  if (petAction && !(Number(statGain) >= 1 && Number(statGain) <= 100)) {
    alert("ไอเทมที่ใช้กับน้องหมาได้ ต้องระบุค่าที่เติมให้ 1-100 %");
    return;
  }

  const confirmBtn = document.querySelector(".edit-confirm-btn");
  confirmBtn.disabled = true;

  try {
    const payload = {
      name,
      description: desc,
      price,
      category,
      petAction: petAction || null,
      statGain: petAction ? Number(statGain) : 0,
      // ตั้งพันธุ์ได้เฉพาะหมวดสัตว์เลี้ยง ย้ายไปหมวดอื่นแล้วล้างพันธุ์ทิ้ง
      petBreed: category === "สัตว์เลี้ยง" ? document.getElementById("editItemPetBreed").value || null : null,
    };
    if (category === "คูปอง") {
      payload.discountBaht = Number(document.getElementById("editItemDiscount").value) || 0;
      payload.requiredPostChapters = Number(document.getElementById("editItemReqChapters").value) || 0;
      payload.requiredGameWorlds = Number(document.getElementById("editItemReqWorlds").value) || 0;
    }

    if (selectedProductFile) {
      const formData = new FormData();
      formData.append("file", selectedProductFile);
      const uploadResult = await adminApiFetch("/admin/upload?type=product", {
        method: "POST",
        body: formData,
      });
      payload.img = uploadResult.url;
    }

    if (editingProductId) {
      await adminApiFetch(`/admin/products/${editingProductId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
    } else {
      await adminApiFetch("/admin/products", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    }

    alert("✅ บันทึกเรียบร้อยแล้ว!");
    closeEditModal();
    await loadProducts();
  } catch (err) {
    alert("เกิดข้อผิดพลาด: " + err.message);
  } finally {
    confirmBtn.disabled = false;
  }
}

async function deleteProduct(id) {
  if (!(await adminConfirm("ลบสินค้านี้แน่ใจไหม? (จะหายไปจากกระเป๋าของผู้ใช้ทุกคนที่มีไอเทมนี้อยู่ด้วย)"))) return;
  try {
    await adminApiFetch(`/admin/products/${id}`, { method: "DELETE" });
    await loadProducts();
  } catch (err) {
    alert("ลบไม่สำเร็จ: " + err.message);
  }
}

// ─── INIT ─────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  if (!getAdminToken()) return; // adminAuth.js จะเด้งไป login ให้แล้ว

  loadProducts();
  loadDogSale();

  document.getElementById("editItemModal").addEventListener("click", function (e) {
    if (e.target === this) closeEditModal();
  });

  document.getElementById("searchInput")?.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      searchProduct();
    }
  });
});

// ─── เปิด/ปิดการขายน้องหมาตัวใหม่ ──────────────────────────────
let dogSaleEnabled = true;

function renderDogSale() {
  const btn = document.getElementById("dogSaleBtn");
  if (!btn) return;
  btn.disabled = false;
  btn.classList.toggle("is-off", !dogSaleEnabled);
  btn.textContent = dogSaleEnabled ? "🐶 เปิดขายน้องหมาอยู่" : "🐶 ปิดขายน้องหมาอยู่";
  btn.title = dogSaleEnabled ? "กดเพื่อปิดการขายน้องหมาตัวใหม่" : "กดเพื่อเปิดการขายน้องหมาตัวใหม่";
}

async function loadDogSale() {
  try {
    ({ enabled: dogSaleEnabled } = await adminApiFetch("/admin/dog-sale"));
    renderDogSale();
  } catch (err) {
    console.error("โหลดสถานะการขายน้องหมาไม่สำเร็จ:", err);
  }
}

async function toggleDogSale() {
  const next = !dogSaleEnabled;
  const ok = await adminConfirm(
    next
      ? "เปิดขายน้องหมาตัวใหม่? ผู้ใช้จะใช้คอยน์ซื้อน้องหมาพันธุ์อื่นเพิ่มได้"
      : "ปิดขายน้องหมาตัวใหม่? ผู้ใช้จะซื้อเพิ่มไม่ได้ (ตัวที่ซื้อไปแล้วยังอยู่และสลับเลี้ยงได้ตามเดิม)",
    { title: next ? "เปิดขายน้องหมา" : "ปิดขายน้องหมา" }
  );
  if (!ok) return;
  const btn = document.getElementById("dogSaleBtn");
  btn.disabled = true;
  try {
    ({ enabled: dogSaleEnabled } = await adminApiFetch("/admin/dog-sale", {
      method: "PUT",
      body: JSON.stringify({ enabled: next }),
    }));
  } catch (err) {
    alert(err.message);
  }
  renderDogSale();
}
