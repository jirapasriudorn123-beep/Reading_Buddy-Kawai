// ระบบสลับโหมดกลางคืน — ใช้ได้ทุกหน้าที่แปะ <script src="theme.js"> ไว้
// ปุ่มลอยมุมขวาบนจะถูกสร้างขึ้นเองอัตโนมัติ ไม่ต้องแก้ไข HTML เพิ่ม
(function () {
  const STORAGE_KEY = "theme";

  function getSavedTheme() {
    return localStorage.getItem(STORAGE_KEY) || "light";
  }

  function applyTheme(theme) {
    document.documentElement.classList.toggle("dark-mode", theme === "dark");
  }

  function updateButtonIcon(theme) {
    const btn = document.getElementById("themeToggleBtn");
    if (btn) btn.textContent = theme === "dark" ? "☀️" : "🌙";
  }

  function toggleTheme() {
    const next = getSavedTheme() === "dark" ? "light" : "dark";
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
    updateButtonIcon(next);
  }

  function createToggleButton() {
    if (document.getElementById("themeToggleBtn")) return; // กันสร้างซ้ำ

    const btn = document.createElement("button");
    btn.id = "themeToggleBtn";
    btn.type = "button";
    btn.setAttribute("aria-label", "สลับโหมดกลางคืน");
    btn.addEventListener("click", toggleTheme);

    // ถ้าหน้านี้มีช่อง #themeToggleSlot (เช่นในแถว user-stats) ให้ใส่ปุ่มตรงนั้นแทน
    // เพื่อให้ปุ่มอยู่ในแถวเดียวกับไอคอนเหรียญ/แจ้งเตือน ไม่ใช่ลอยมุมจอ
    const slot = document.getElementById("themeToggleSlot");
    if (slot) {
      slot.appendChild(btn);
    } else {
      document.body.appendChild(btn); // หน้าที่ไม่มีช่องนี้ (เช่น login/register) ใช้ปุ่มลอยมุมขวาบนแทน
    }

    updateButtonIcon(getSavedTheme());
  }

  document.addEventListener("DOMContentLoaded", () => {
    applyTheme(getSavedTheme());
    createToggleButton();
  });
})();