// เปิดไฟล์ HTML ตรงๆ (file://) ก็ใช้ backend ในเครื่องด้วย เพราะ backend บน Render รับเฉพาะ origin ของ GitHub Pages
const API_BASE_URL =
  location.hostname === "localhost" || location.hostname === "127.0.0.1" || location.protocol === "file:"
    ? "http://localhost:3000/api"
    : location.hostname.includes("app.github.dev")
    ? location.origin.replace(/-5500./, "-3000.") + "/api"
    : "https://reading-buddy-kawai.onrender.com/api";

// กัน HTML/JS ที่อยู่ในข้อมูล (ชื่อสินค้า, username, ฯลฯ) รันจริงเวลาถูก render ผ่าน innerHTML
// ใช้ทุกจุดที่เอา string จาก API หรือ user input ไปประกอบ template string แล้วใส่ innerHTML
function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// รูปคอยน์ของเราเอง (img/coin_ja.png) ใช้แทนอิโมจิ 🪙 ทุกหน้า
// withCoinIcon ใช้กับ HTML ที่ escape แล้ว / coinTextHtml ใช้กับข้อความล้วนที่ขึ้นบรรทัดใหม่ด้วย \n
const COIN_ICON_HTML = '<img src="img/coin_ja.png" alt="คอยน์" class="coin-inline">';

function withCoinIcon(html) {
  return String(html ?? "").split("🪙").join(COIN_ICON_HTML);
}

function coinTextHtml(text) {
  return withCoinIcon(escapeHtml(text).replace(/\n/g, "<br>"));
}
