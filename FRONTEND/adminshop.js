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
      const petUseHTML = p.pet_action
        ? `<p class="pet-use-note">${PET_ACTION_LABEL[p.pet_action]} +${p.stat_gain}%</p>`
        : `<p class="pet-use-note muted">ของสะสม (ใช้กับน้องไม่ได้)</p>`;
      const safeName = escapeHtml(p.name);
      const safeId = escapeHtml(p.id);
      return `
            <div class="product-card">
                ${tagHTML}
                <p><strong>${safeName}</strong></p>
                ${petUseHTML}
                <img src="${escapeHtml(resolveProductImg(p.img))}" width="100" alt="${safeName}" onerror="this.src='img/placeholder.png'">
                <button class="price-btn"><img src="img/coin_ja.png" alt="เหรียญ" class="price-coin-icon">${p.price}</button>
                <div class="admin-card-actions">
                    <button class="edit-item-btn" onclick="openEditModal('${safeId}')">✏️ แก้ไข</button>
                    <button class="delete-item-btn" onclick="deleteProduct('${safeId}')">🗑️ ลบ</button>
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

function resetModalFields() {
  document.getElementById("editItemId").value = "";
  document.getElementById("editItemName").value = "";
  document.getElementById("editItemDesc").value = "";
  document.getElementById("editItemPrice").value = "";
  document.getElementById("editItemCategory").value = "อาหาร";
  document.getElementById("editItemPetAction").value = "";
  document.getElementById("editItemStatGain").value = "";
  togglePetGainField();

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
  togglePetGainField();

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
    };

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
  if (!confirm("ลบสินค้านี้แน่ใจไหม? (จะหายไปจากกระเป๋าของผู้ใช้ทุกคนที่มีไอเทมนี้อยู่ด้วย)")) return;
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
