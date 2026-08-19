// ================== ตัวช่วยเรียก API ==================

function getToken() {
  return localStorage.getItem("token");
}

async function apiFetch(path, options = {}) {
  const token = getToken();

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
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

// URL รากของ backend (ไม่มี /api ต่อท้าย) ใช้สร้าง URL เต็มของรูปสินค้าที่แอดมินอัปโหลดไว้
const UPLOADS_BASE_URL = API_BASE_URL.replace(/\/api\/?$/, "");

// สินค้าที่ seed ไว้เก็บ img เป็นชื่อไฟล์ในโฟลเดอร์ img/ ของ frontend
// ส่วนสินค้าที่แอดมินอัปโหลดเองเก็บเป็น path ของ backend (/uploads/products/xxx.png) ต้องเติม origin ของ backend ให้ด้วย
function resolveProductImg(img) {
  if (!img) return "img/placeholder.png";
  if (img.startsWith("http")) return img;
  if (img.startsWith("/")) return `${UPLOADS_BASE_URL}${img}`;
  return `img/${img}`;
}

let allProducts = [];
let tempItem = null; // สินค้าที่กำลังเปิด modal รายละเอียดอยู่
let cart = []; // ตะกร้า (เก็บแค่ฝั่ง browser จนกว่าจะกด checkout)

// ================== เริ่มทำงานเมื่อโหลดหน้า ==================

document.addEventListener("DOMContentLoaded", async () => {
  if (!getToken()) {
    window.location.href = "login.html";
    return;
  }

  setupSidebarToggle();
  bindLogout();

  const searchInput = document.getElementById("searchInput");
  if (searchInput) {
    searchInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        searchProduct();
      }
    });
  }

  try {
    await Promise.all([loadUserCoins(), loadCurrentPet()]);
    await loadProducts();
  } catch (err) {
    console.error("โหลดข้อมูลร้านค้าไม่สำเร็จ:", err);
  }
});

// ================== เหรียญผู้ใช้ ==================

async function loadUserCoins() {
  const { user } = await apiFetch("/auth/me");
  updateCoinDisplay(user.coins);
}

// ================== สัตว์เลี้ยงปัจจุบัน (ใช้เช็คว่าพันธุ์นี้มีอยู่แล้วในร้าน) ==================

let currentPetBreed = null;

async function loadCurrentPet() {
  try {
    const { pet } = await apiFetch("/pet");
    currentPetBreed = pet ? pet.breed : null;
  } catch {
    currentPetBreed = null;
  }
}

// จับคู่ชื่อสินค้า → รหัสพันธุ์ที่ backend ใช้ (golden/shiba/siberian/thairidgeback)
// admin ตั้งชื่อสินค้าเองใน adminshop เลยใช้ substring match — ครอบคลุมทั้งไทย/อังกฤษ
function getBreedFromProductName(name) {
  if (!name) return null;
  const s = name.toLowerCase();
  if (s.includes("ชิบะ") || s.includes("shiba")) return "shiba";
  if (s.includes("โกลเด้น") || s.includes("golden")) return "golden";
  if (s.includes("ไซบีเรียน") || s.includes("ฮัสกี้") || s.includes("husky") || s.includes("siberian")) return "siberian";
  if (s.includes("ไทยหลังอาน") || s.includes("หลังอาน") || s.includes("ridgeback") || s.includes("thai")) return "thairidgeback";
  return null;
}

function updateCoinDisplay(coins) {
  const coinAmountEl = document.getElementById("coinAmount");
  if (coinAmountEl) coinAmountEl.textContent = coins;
}

// ================== โหลด + แสดงสินค้า ==================

async function loadProducts() {
  const { products } = await apiFetch("/shop/products");
  allProducts = products;
  renderProducts(allProducts);
}

function renderProducts(items) {
  const grid = document.getElementById("productGrid");
  if (!grid) return;

  grid.style.display = "grid";
  grid.style.rowGap = "40px";
  grid.innerHTML = items
    .map((p) => {
      const safeName = escapeHtml(p.name);
      const safeId = escapeHtml(p.id);
      const tagHTML = p.tag ? `<span class="product-tag">${escapeHtml(p.tag)}</span>` : "";
      // ถ้าสินค้าเป็นพันธุ์ที่ user มีอยู่แล้ว → โชว์ป้าย "มีอยู่แล้ว" แทนราคา
      // การ์ดคลิกไม่ได้ (ปิด showDetail) กันไม่ให้ซื้อซ้ำโดยไม่ตั้งใจ
      const productBreed = getBreedFromProductName(p.name);
      const isOwnedBreed = productBreed && productBreed === currentPetBreed;
      const footerHTML = isOwnedBreed
        ? `<div class="owned-badge">✓ มีอยู่แล้ว</div>`
        : `<div class="buy-now-action">
             <img src="img/coin_ja.png" alt="เหรียญ" class="coin-icon-img">
             <span class="price-val">${p.price}</span>
           </div>`;
      const cardClickAttr = isOwnedBreed ? "" : `onclick="showDetail('${safeId}')"`;
      // สินค้าหมวด "คูปอง" ใช้ดีไซน์การ์ดคูปองแยก (มีเส้นประกลาง, ขอบเว้า, พื้นเหลืองอ่อน)
      const isCoupon = p.category === "คูปอง";
      const cardClass = ["product-card"];
      if (isOwnedBreed) cardClass.push("owned");
      if (isCoupon) cardClass.push("coupon-card");
      return `
        <div class="${cardClass.join(" ")}" ${cardClickAttr}>
          ${tagHTML}
          <div class="product-card-header">
            <h4>${safeName}</h4>
          </div>
          <div class="product-img-container">
            <img src="${escapeHtml(resolveProductImg(p.img))}" alt="${safeName}" onerror="this.src='img/placeholder.png'">
          </div>
          <div class="product-card-footer">
            ${footerHTML}
          </div>
        </div>
      `;
    })
    .join("");
}

function filterItems(categoryName) {
  document.querySelectorAll(".tab-btn").forEach((tab) => {
    tab.classList.remove("active");
    if (tab.innerText === categoryName) tab.classList.add("active");
  });

  // แสดง banner โปรโมทหมวดสัตว์เลี้ยง (ด้านล่าง) เฉพาะตอนอยู่ tab "คูปอง"
  const banner = document.getElementById("couponHeroBanner");
  if (banner) banner.style.display = categoryName === "คูปอง" ? "block" : "none";

  const filtered = categoryName === "ทั้งหมด" ? allProducts : allProducts.filter((p) => p.category === categoryName);
  renderProducts(filtered);
}

function searchProduct() {
  const searchInput = document.getElementById("searchInput");
  const term = searchInput.value.trim().toLowerCase();

  if (term === "") {
    renderProducts(allProducts);
    return;
  }

  renderProducts(allProducts.filter((p) => p.name.toLowerCase().includes(term)));
}

// ================== รายละเอียดสินค้า (Modal) ==================

const MAX_BUY_QUANTITY = 99; // ต้องตรงกับ MAX_BUY_QUANTITY ใน BACKEND/src/routes/shop.js

// อ่านจำนวนที่ผู้ใช้เลือก แล้วบีบให้อยู่ในช่วงที่ซื้อได้จริงเสมอ (เผื่อพิมพ์เป็น 0 ติดลบ ทศนิยม หรือเว้นว่าง)
function getModalQty() {
  const input = document.getElementById("modalQty");
  if (!input) return 1;
  const qty = Math.floor(Number(input.value));
  if (!Number.isFinite(qty) || qty < 1) return 1;
  return Math.min(MAX_BUY_QUANTITY, qty);
}

function setModalQty(qty) {
  const input = document.getElementById("modalQty");
  if (input) input.value = qty;
  updateModalTotalPrice();
}

function changeModalQty(delta) {
  setModalQty(Math.max(1, Math.min(MAX_BUY_QUANTITY, getModalQty() + delta)));
}

// ระหว่างพิมพ์ไม่ไปแก้ค่าในช่องใต้มือ (จะพิมพ์ลำบาก) แค่อัปเดตราคารวมให้ตาม
function onModalQtyInput() {
  updateModalTotalPrice();
}

// ราคาบนปุ่มซื้อ = ราคาต่อชิ้น x จำนวน จะได้เห็นยอดจริงก่อนกด
function updateModalTotalPrice() {
  if (!tempItem) return;
  const priceEl = document.getElementById("modalBuyPrice");
  if (priceEl) priceEl.innerText = tempItem.price * getModalQty();
}

function showDetail(id) {
  const product = allProducts.find((p) => p.id === id);
  if (!product) return;

  tempItem = product;

  document.getElementById("modalName").innerText = product.name;
  document.getElementById("modalImg").src = resolveProductImg(product.img);
  document.getElementById("modalDesc").innerText = product.description || "ไม่มีรายละเอียดสินค้า";
  setModalQty(1); // เปิด modal ใหม่ทุกครั้งเริ่มที่ 1 เสมอ (setModalQty อัปเดตราคารวมให้ด้วย)

  document.getElementById("productModal").style.display = "flex";
}

function closeModal(id) {
  document.getElementById(id).style.display = "none";
}

function closeModalOutside(event) {
  if (event.target.id === "productModal") closeModal("productModal");
}

// ================== ซื้อทันที (หักเหรียญจริงผ่าน backend) ==================

async function buyNow() {
  if (!tempItem) return;

  const quantity = getModalQty();
  const buyBtn = document.querySelector(".buy-now-btn");
  if (buyBtn) buyBtn.disabled = true; // กันกดรัวจนซื้อซ้ำเกินที่ตั้งใจ

  try {
    const result = await apiFetch("/shop/buy", {
      method: "POST",
      body: JSON.stringify({ productId: tempItem.id, quantity }),
    });

    updateCoinDisplay(result.coins);
    alert(result.message);
    closeModal("productModal");
  } catch (err) {
    alert("❌ " + err.message);
  } finally {
    if (buyBtn) buyBtn.disabled = false;
  }
}

// ================== ตะกร้า (เก็บฝั่ง browser ก่อน ค่อยหักเหรียญตอน checkout) ==================

function addToCart() {
  if (!tempItem) return;

  const quantity = getModalQty();
  const found = cart.find((item) => item.id === tempItem.id);
  if (found) {
    found.qty = Math.min(MAX_BUY_QUANTITY, found.qty + quantity);
  } else {
    cart.push({ ...tempItem, qty: quantity });
  }

  updateCartCount();
  alert(quantity > 1 ? `เพิ่ม ${tempItem.name} ${quantity} ชิ้นลงตะกร้าเรียบร้อย!` : "เพิ่มลงตะกร้าเรียบร้อย!");
  closeModal("productModal");
}

function updateCartCount() {
  const countElement = document.getElementById("cartCount");
  if (!countElement) return;

  const totalQty = cart.reduce((sum, item) => sum + item.qty, 0);
  if (totalQty > 0) {
    countElement.innerText = totalQty;
    countElement.style.display = "flex";
  } else {
    countElement.style.display = "none";
  }
}

function openCart() {
  const itemList = document.getElementById("cartItemList");
  const summaryList = document.getElementById("summaryList");
  const totalCoinsEl = document.getElementById("totalCoins");
  const cartModal = document.getElementById("cartModal");

  if (!itemList || !summaryList) return;

  itemList.innerHTML = "";
  summaryList.innerHTML = "";
  let total = 0;

  cart.forEach((item, index) => {
    const subtotal = item.price * item.qty;
    total += subtotal;

    const safeName = escapeHtml(item.name);
    itemList.innerHTML += `
      <div class="cart-item">
        <img src="${escapeHtml(resolveProductImg(item.img))}" onerror="this.src='img/placeholder.png'">
        <div class="item-info">
          <span class="item-name">${safeName}</span>
          <div class="item-price">💰 ${item.price}</div>
        </div>
        <div class="quantity-control">
          <button class="qty-btn" onclick="changeQty(${index}, -1)">-</button>
          <span>${item.qty}</span>
          <button class="qty-btn" onclick="changeQty(${index}, 1)">+</button>
        </div>
        <button class="remove-row-btn" onclick="removeItem(${index})">×</button>
      </div>
    `;

    summaryList.innerHTML += `
      <div style="display:flex; justify-content:space-between; margin-bottom: 8px;">
        <span>${safeName} x ${item.qty}</span>
        <span>${subtotal}</span>
      </div>
    `;
  });

  if (totalCoinsEl) totalCoinsEl.innerText = total;
  const titleEl = document.getElementById("cartCountTitle");
  if (titleEl) titleEl.innerText = `${cart.length} ไอเทมอยู่ในตะกร้า`;
  if (cartModal) cartModal.style.display = "flex";
}

function changeQty(index, amount) {
  cart[index].qty = Math.min(MAX_BUY_QUANTITY, cart[index].qty + amount);
  if (cart[index].qty <= 0) cart.splice(index, 1);
  updateCartCount();
  openCart();
}

function removeItem(index) {
  cart.splice(index, 1);
  updateCartCount();
  openCart();
}

function closeCartOutside(event) {
  if (event.target.id === "cartModal") {
    document.getElementById("cartModal").style.display = "none";
  }
}

// ซื้อของทั้งหมดในตะกร้าทีเดียว (หักเหรียญจริงทีละชิ้นผ่าน backend)
async function checkout() {
  if (cart.length === 0) return;

  try {
    // ยิงครั้งเดียวต่อสินค้า 1 ชนิด (ส่งจำนวนไปให้ backend หักเหรียญทีเดียว) ไม่ต้องยิงทีละชิ้นเหมือนเดิม
    let lastCoins = null;
    for (const item of cart) {
      const result = await apiFetch("/shop/buy", {
        method: "POST",
        body: JSON.stringify({ productId: item.id, quantity: item.qty }),
      });
      lastCoins = result.coins;
    }

    if (lastCoins !== null) updateCoinDisplay(lastCoins);
    cart = [];
    updateCartCount();
    document.getElementById("cartModal").style.display = "none";
    alert("🎉 ชำระเงินสำเร็จ!");
  } catch (err) {
    alert("❌ ชำระเงินไม่สำเร็จ: " + err.message);
  }
}

// ================== Sidebar toggle + Logout ==================

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

function bindLogout() {
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", (e) => {
      e.preventDefault();
      localStorage.removeItem("token");
      localStorage.removeItem("currentUser");
      window.location.href = "login.html";
    });
  }
}