const jwt = require("jsonwebtoken");
const db = require("../db/database");

// middleware สำหรับป้องกัน route ที่ต้อง login ก่อนถึงจะเข้าถึงได้
function requireAuth(req, res, next) {
  const authHeader = req.headers["authorization"]; // รูปแบบ: "Bearer <token>"

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "กรุณาเข้าสู่ระบบก่อน" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { id, email, username, isAdmin }
    // เก็บเวลาใช้งานล่าสุดแบบ fire-and-forget (ไม่ block request ถ้า DB ช้า/ล้ม)
    db.prepare("UPDATE users SET last_active_at = datetime('now') WHERE id = ?")
      .run(payload.id)
      .catch(() => {});
    next();
  } catch (err) {
    return res.status(401).json({ message: "Token ไม่ถูกต้องหรือหมดอายุ กรุณาเข้าสู่ระบบใหม่" });
  }
}

// middleware สำหรับ route ที่ต้องเป็นแอดมินเท่านั้น (เช็คสิทธิ์จาก isAdmin ใน JWT payload ที่ requireAuth ถอดรหัสไว้แล้ว)
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!req.user.isAdmin) {
      return res.status(403).json({ message: "ต้องเป็นแอดมินเท่านั้นถึงจะเข้าถึงส่วนนี้ได้" });
    }
    next();
  });
}

module.exports = { requireAuth, requireAdmin };
