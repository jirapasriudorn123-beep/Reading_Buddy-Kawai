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

let userReadingMinutes = 0; // เวลาอ่านสะสมรวม (นาที) ของ user — ใช้เช็คแลกคูปอง
let redeemedCouponIds = new Set(); // คูปองแบบที่แลกไปแล้ว (แต่ละแบบแลกได้ครั้งเดียว)
let univVerified = false; // ยืนยันอีเมลมหาวิทยาลัยแล้วหรือยัง (ต้องยืนยันก่อนแลกคูปอง)
let currentTab = "ทั้งหมด";

async function loadProducts() {
  const data = await apiFetch("/shop/products");
  allProducts = data.products;
  userReadingMinutes = data.readingMinutes || 0;
  redeemedCouponIds = new Set(data.redeemedCouponIds || []);
  univVerified = !!data.univVerified;
  updateCouponToolbar();
  // เริ่มที่ tab "ทั้งหมด" (filterItems จะกรองคูปองออก + toggle banner ให้เอง) หรือ tab เดิมตอนโหลดใหม่หลังแลก
  filterItems(currentTab);
}

// คูปองส่วนลดร้านจริง = หมวดคูปองที่มีมูลค่าส่วนลด (ของเก่าในหมวดคูปองที่ไม่มีมูลค่ายังซื้อเข้ากระเป๋าตามปกติ)
function isRealCoupon(p) {
  return p.category === "คูปอง" && p.discount_baht > 0;
}

function updateCouponToolbar() {
  const statusEl = document.getElementById("couponVerifyStatus");
  if (statusEl) {
    statusEl.innerHTML = univVerified
      ? `<span class="verify-ok">✅ ยืนยันอีเมลมหาวิทยาลัยแล้ว แลกคูปองได้</span>`
      : `<span class="verify-need">📧 ต้องยืนยันอีเมล @up.ac.th ก่อนแลกคูปอง</span>
         <button type="button" class="coupon-link-btn" onclick="openUnivEmailModal()">ยืนยันเลย</button>`;
  }
  const countEl = document.getElementById("myCouponCount");
  if (countEl) countEl.textContent = redeemedCouponIds.size ? `(${redeemedCouponIds.size})` : "";
}

// แปลง (นาที) → "X ชม. Y นาที" (ตัด "Y นาที" ถ้า = 0)
function formatMinsHours(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h} ชม. ${m} นาที`;
  if (h) return `${h} ชม.`;
  return `${m} นาที`;
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
      // สินค้าหมวด "คูปอง" render เป็น banner ใหญ่ 1 แถวต่อชิ้น
      // คลิก → เปิด modal แสดง เงื่อนไข + ปุ่มแลก (ถ้าอ่านครบ)
      const isCoupon = p.category === "คูปอง";
      if (isCoupon) {
        const requiredMins = p.required_reading_minutes || 0;
        const unlocked = userReadingMinutes >= requiredMins;
        // แลกแล้ว: ทับด้วยป้าย "แลกแล้ว" คลิกแล้วเปิดคูปองของฉันแทน
        if (isRealCoupon(p) && redeemedCouponIds.has(p.id)) {
          return `
            <div class="coupon-banner redeemed" onclick="openMyCoupons()" title="ดูในคูปองของฉัน">
              <img class="coupon-banner-img" src="${escapeHtml(resolveProductImg(p.img))}"
                   alt="${safeName}" onerror="this.style.display='none'; this.parentElement.classList.add('no-img');">
              <div class="coupon-banner-fallback">
                <div class="coupon-banner-fallback-name">🎫 ${safeName}</div>
              </div>
              <div class="coupon-redeemed-overlay"><span>✓ แลกแล้ว — ดูใน "คูปองของฉัน"</span></div>
            </div>
          `;
        }
        const progressPct = requiredMins ? Math.min(100, Math.round((userReadingMinutes / requiredMins) * 100)) : 100;
        const lockOverlay = unlocked
          ? ""
          : `<div class="coupon-lock">
               <div class="coupon-lock-inner">
                 🔒 อ่านต่ออีก ${formatMinsHours(requiredMins - userReadingMinutes)} เพื่อปลดล็อค
                 <div class="coupon-progress"><div class="coupon-progress-bar" style="width:${progressPct}%"></div></div>
                 <div class="coupon-progress-text">${formatMinsHours(userReadingMinutes)} / ${formatMinsHours(requiredMins)}</div>
               </div>
             </div>`;
        // ราคาเป็นคอยน์ (แลกด้วยเหรียญ) — โชว์มุมขวาล่างของ banner
        const priceTag = p.price > 0
          ? `<div class="coupon-price-tag"><img src="img/coin_ja.png" alt="เหรียญ">${p.price} คอยน์</div>`
          : "";
        return `
          <div class="coupon-banner ${unlocked ? "" : "locked"}" onclick="showDetail('${safeId}')" title="คลิกเพื่อดูรายละเอียด">
            <img class="coupon-banner-img" src="${escapeHtml(resolveProductImg(p.img))}"
                 alt="${safeName}" onerror="this.style.display='none'; this.parentElement.classList.add('no-img');">
            <div class="coupon-banner-fallback">
              <div class="coupon-banner-fallback-name">🎫 ${safeName}</div>
              <div class="coupon-banner-fallback-hint">คลิกเพื่อดูรายละเอียด</div>
            </div>
            ${priceTag}
            ${lockOverlay}
          </div>
        `;
      }
      const cardClass = ["product-card"];
      if (isOwnedBreed) cardClass.push("owned");
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
  currentTab = categoryName;
  const toolbar = document.getElementById("couponToolbar");
  if (toolbar) toolbar.style.display = categoryName === "คูปอง" ? "flex" : "none";

  document.querySelectorAll(".tab-btn").forEach((tab) => {
    tab.classList.remove("active");
    if (tab.innerText === categoryName) tab.classList.add("active");
  });

  // แสดง banner + เงื่อนไขคูปอง (ด้านล่าง) เฉพาะตอนอยู่ tab "คูปอง"
  const bannerWrap = document.getElementById("couponBannerWrap");
  if (bannerWrap) bannerWrap.style.display = categoryName === "คูปอง" ? "block" : "none";

  // tab "ทั้งหมด" ตัดคูปองออก (คูปองมี banner + terms พิเศษเฉพาะ tab ของตัวเอง ไม่เข้ากับ grid สินค้าปกติ)
  const filtered =
    categoryName === "ทั้งหมด"
      ? allProducts.filter((p) => p.category !== "คูปอง")
      : allProducts.filter((p) => p.category === categoryName);
  renderProducts(filtered);
}

function searchProduct() {
  const searchInput = document.getElementById("searchInput");
  const term = searchInput.value.trim().toLowerCase();

  // ค้นหาไม่แสดงคูปอง (คูปองอยู่ tab ของตัวเองเท่านั้น)
  const searchable = allProducts.filter((p) => p.category !== "คูปอง");
  if (term === "") {
    renderProducts(searchable);
    return;
  }

  renderProducts(searchable.filter((p) => p.name.toLowerCase().includes(term)));
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
// สำหรับคูปอง (dataset.couponLabel ตั้งไว้จาก showDetail) เปลี่ยนปุ่มเป็นข้อความ "แลกคูปอง" แทน
function updateModalTotalPrice() {
  if (!tempItem) return;
  const priceEl = document.getElementById("modalBuyPrice");
  if (!priceEl) return;
  const buyBtn = document.querySelector(".buy-now-btn");
  const couponLabel = buyBtn?.dataset?.couponLabel;
  if (couponLabel) {
    priceEl.innerText = couponLabel;
  } else {
    priceEl.innerText = tempItem.price * getModalQty();
  }
}

function showDetail(id) {
  const product = allProducts.find((p) => p.id === id);
  if (!product) return;

  tempItem = product;

  document.getElementById("modalName").innerText = product.name;
  document.getElementById("modalImg").src = resolveProductImg(product.img);
  // คูปอง: เติมข้อมูล requirement + progress ก่อน description
  const isCoupon = product.category === "คูปอง";
  const desc = product.description || (isCoupon ? "ยังไม่ระบุเงื่อนไขการใช้งาน" : "ไม่มีรายละเอียดสินค้า");
  if (isCoupon) {
    const reqMins = product.required_reading_minutes || 0;
    const unlocked = userReadingMinutes >= reqMins;
    const priceLine = product.price > 0 ? `🪙 ใช้ ${product.price} คอยน์ แลกคูปองนี้\n\n` : "";
    const header = reqMins
      ? `⏱️ ต้องอ่านสะสม ${formatMinsHours(reqMins)}\n` +
        `📖 คุณอ่านไปแล้ว ${formatMinsHours(userReadingMinutes)}` +
        (unlocked ? " ✅ ปลดล็อคแล้ว!" : ` (ขาดอีก ${formatMinsHours(reqMins - userReadingMinutes)})`) +
        `\n\n`
      : "";
    document.getElementById("modalDesc").innerText = priceLine + header + `📋 เงื่อนไขการใช้งาน\n\n${desc}`;
  } else {
    document.getElementById("modalDesc").innerText = desc;
  }
  setModalQty(1);

  // คูปองส่วนลดแลกได้ทีละ 1 ใบ และไม่ผ่านตะกร้า — ซ่อนช่องจำนวนกับปุ่มเพิ่มลงตะกร้า
  const realCoupon = isRealCoupon(product);
  const qtyRow = document.getElementById("modalQtyRow");
  if (qtyRow) qtyRow.style.display = realCoupon ? "none" : "";
  const cartBtn = document.getElementById("modalAddToCartBtn");
  if (cartBtn) cartBtn.style.display = realCoupon ? "none" : "";

  // ปุ่มซื้อคูปอง = "แลกคูปอง" + disable ถ้าอ่านยังไม่ครบ / แลกไปแล้ว
  const buyBtn = document.querySelector(".buy-now-btn");
  if (buyBtn) {
    if (isCoupon) {
      const reqMins = product.required_reading_minutes || 0;
      const unlocked = userReadingMinutes >= reqMins;
      const redeemed = realCoupon && redeemedCouponIds.has(product.id);
      buyBtn.disabled = !unlocked || redeemed;
      // คูปองที่มีราคา: ปุ่มโชว์ราคาเหมือนสินค้าทั่วไป (ข้อความ "ใช้ X คอยน์ แลกคูปองนี้" อยู่ในรายละเอียดแล้ว)
      let label = product.price > 0 ? String(product.price) : "แลกคูปอง";
      if (redeemed) label = "✓ แลกแล้ว";
      else if (!unlocked) label = "🔒 ยังปลดล็อคไม่ได้";
      else if (realCoupon && !univVerified) label = "📧 ยืนยันอีเมลก่อนแลก";
      buyBtn.dataset.couponLabel = label;
    } else {
      buyBtn.disabled = false;
      delete buyBtn.dataset.couponLabel;
    }
  }
  updateModalTotalPrice(); // เรียก re-render ราคาบนปุ่ม (ใช้ dataset.couponLabel ถ้าเป็นคูปอง)

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

  const realCoupon = isRealCoupon(tempItem);
  if (realCoupon && !univVerified) {
    closeModal("productModal");
    openUnivEmailModal();
    return;
  }
  if (realCoupon && !confirm(`แลก${tempItem.name} ด้วย ${tempItem.price} คอยน์?\nคูปองมีอายุ 30 วัน และแลกแบบนี้ได้ครั้งเดียว`)) {
    return;
  }

  const quantity = realCoupon ? 1 : getModalQty();
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
    if (result.coupon) {
      await loadProducts();
      openMyCoupons();
    }
  } catch (err) {
    if (err.data && err.data.code === "UNIV_EMAIL_REQUIRED") {
      closeModal("productModal");
      openUnivEmailModal();
    } else {
      alert("❌ " + err.message);
    }
  } finally {
    if (buyBtn) buyBtn.disabled = false;
  }
}

// ================== ตะกร้า (เก็บฝั่ง browser ก่อน ค่อยหักเหรียญตอน checkout) ==================

function addToCart() {
  if (!tempItem) return;
  if (isRealCoupon(tempItem)) return; // คูปองแลกผ่านปุ่มแลกเท่านั้น (ปุ่มนี้ถูกซ่อนไว้แล้ว)

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

// ================== คูปองส่วนลด: ยืนยันอีเมลมหาวิทยาลัย / คูปองของฉัน / QR ==================

// เวลาจาก backend เป็น UTC แบบ SQLite ("YYYY-MM-DD HH:MM:SS") → แสดงเป็นเวลาไทย
function formatThaiDateTime(sqliteDatetime) {
  if (!sqliteDatetime) return "-";
  return new Date(sqliteDatetime.replace(" ", "T") + "Z").toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function openUnivEmailModal() {
  document.getElementById("univEmailResult").textContent = "";
  document.getElementById("univEmailModal").style.display = "flex";
  document.getElementById("univEmailInput").focus();
}

async function requestUnivEmail() {
  const email = document.getElementById("univEmailInput").value.trim().toLowerCase();
  const resultEl = document.getElementById("univEmailResult");
  if (!/^[a-z0-9._%+-]+@up\.ac\.th$/.test(email)) {
    resultEl.textContent = "❌ กรุณากรอกอีเมลมหาวิทยาลัยที่ลงท้ายด้วย @up.ac.th";
    return;
  }
  if (!document.getElementById("univEmailConsent").checked) {
    resultEl.textContent = "❌ กรุณาติ๊กยินยอมก่อนส่งลิงก์ยืนยัน";
    return;
  }

  const btn = document.getElementById("univEmailSendBtn");
  btn.disabled = true;
  try {
    const data = await apiFetch("/auth/univ-email/request", { method: "POST", body: JSON.stringify({ email }) });
    resultEl.textContent = "✅ " + data.message;
    // ทดสอบในเครื่องที่ยังไม่ได้ตั้งค่าอีเมล: backend ส่งลิงก์กลับมาให้กดได้เลย
    if (data.devVerifyUrl) {
      const link = document.createElement("a");
      link.href = data.devVerifyUrl;
      link.textContent = "🔧 [Dev only] กดยืนยันอีเมลที่นี่";
      link.className = "coupon-dev-link";
      resultEl.appendChild(document.createElement("br"));
      resultEl.appendChild(link);
    }
  } catch (err) {
    resultEl.textContent = "❌ " + err.message;
  } finally {
    btn.disabled = false;
  }
}

const COUPON_STATUS_LABEL = {
  active: "ใช้ได้",
  used: "ใช้แล้ว",
  expired: "หมดอายุ",
};
let myCoupons = [];

async function openMyCoupons() {
  document.getElementById("myCouponsModal").style.display = "flex";
  const listEl = document.getElementById("myCouponsList");
  listEl.innerHTML = `<p class="coupon-empty">กำลังโหลด...</p>`;
  try {
    const data = await apiFetch("/coupons");
    myCoupons = data.coupons;
    renderMyCoupons();
  } catch (err) {
    listEl.innerHTML = `<p class="coupon-empty">❌ โหลดคูปองไม่สำเร็จ: ${escapeHtml(err.message)}</p>`;
  }
}

function renderMyCoupons() {
  const listEl = document.getElementById("myCouponsList");
  if (!myCoupons.length) {
    listEl.innerHTML = `<p class="coupon-empty">ยังไม่มีคูปอง แลกได้ที่แท็บ "คูปอง" ในร้านค้า</p>`;
    return;
  }
  listEl.innerHTML = myCoupons
    .map((c) => {
      const when =
        c.status === "used"
          ? `ใช้แล้วเมื่อ ${escapeHtml(formatThaiDateTime(c.usedAt))}${c.usedShop ? ` ที่ ${escapeHtml(c.usedShop)}` : ""}`
          : `${c.status === "expired" ? "หมดอายุเมื่อ" : "ใช้ได้ถึง"} ${escapeHtml(formatThaiDateTime(c.expiresAt))}`;
      const action =
        c.status === "active"
          ? `<button type="button" class="coupon-primary-btn" onclick="showCouponQr('${escapeHtml(c.code)}')">แสดง QR ให้พนักงาน</button>`
          : "";
      return `
        <div class="my-coupon-card status-${c.status}">
          <img src="${escapeHtml(resolveProductImg(c.img))}" alt="${escapeHtml(c.name)}" onerror="this.style.display='none'">
          <div class="my-coupon-info">
            <div class="my-coupon-name">${escapeHtml(c.name)}</div>
            <div class="my-coupon-meta">ส่วนลด ${c.discountBaht} บาท · รหัส <code>${escapeHtml(c.code)}</code></div>
            <div class="my-coupon-meta">${when}</div>
            <span class="my-coupon-status">${COUPON_STATUS_LABEL[c.status] || c.status}</span>
          </div>
          ${action}
        </div>`;
    })
    .join("");
}

// QR = ลิงก์ไปหน้า coupon-check.html ของเว็บนี้ พนักงานสแกนด้วยกล้องมือถือได้เลย ไม่ต้องลงแอป
let couponQrPollTimer = null;

function showCouponQr(code) {
  const coupon = myCoupons.find((c) => c.code === code);
  if (!coupon) return;

  const checkUrl = new URL(`coupon-check.html?code=${encodeURIComponent(code)}`, window.location.href).href;
  document.getElementById("couponQrTitle").textContent = coupon.name;
  const box = document.getElementById("couponQrBox");
  box.innerHTML = "";
  box.classList.remove("used");
  if (typeof QRCode === "function") {
    new QRCode(box, { text: checkUrl, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });
  } else {
    box.textContent = "โหลดตัวสร้าง QR ไม่สำเร็จ ให้พนักงานกรอกรหัสด้านล่างแทน";
  }
  document.getElementById("couponQrCode").textContent = code;
  document.getElementById("couponQrInfo").textContent =
    `ส่วนลด ${coupon.discountBaht} บาท · ใช้ได้ถึง ${formatThaiDateTime(coupon.expiresAt)}\nให้พนักงานสแกน QR แล้วกรอก PIN ร้านเพื่อยืนยัน`;
  document.getElementById("couponQrModal").style.display = "flex";

  // เช็คสถานะทุก 3 วิ — พนักงานกดยืนยันแล้ว จอผู้ใช้เปลี่ยนเป็น "ใช้แล้ว" ทันที (QR หายไป ใช้ซ้ำไม่ได้)
  clearInterval(couponQrPollTimer);
  couponQrPollTimer = setInterval(async () => {
    try {
      const data = await apiFetch("/coupons");
      myCoupons = data.coupons;
      const now = myCoupons.find((c) => c.code === code);
      if (now && now.status !== "active") {
        clearInterval(couponQrPollTimer);
        box.innerHTML = `<div class="coupon-qr-used">✅<br>${now.status === "used" ? "ใช้คูปองแล้ว" : "คูปองหมดอายุ"}</div>`;
        box.classList.add("used");
        document.getElementById("couponQrInfo").textContent =
          now.status === "used"
            ? `ใช้แล้วเมื่อ ${formatThaiDateTime(now.usedAt)}${now.usedShop ? ` ที่ ${now.usedShop}` : ""}`
            : "คูปองนี้หมดอายุแล้ว";
        renderMyCoupons();
      }
    } catch (err) {
      console.error("เช็คสถานะคูปองไม่สำเร็จ:", err);
    }
  }, 3000);
}

function closeCouponQr() {
  clearInterval(couponQrPollTimer);
  closeModal("couponQrModal");
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