const API_BASE_URL =
  location.hostname === "localhost" || location.hostname === "127.0.0.1"
    ? "http://localhost:3000/api"
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
