// ================== Cloudinary upload config ==================
// เก็บรูป/PDF ที่ user & admin อัปโหลด ไว้บน Cloudinary แทน disk ของ Render
// (Render free tier ลบไฟล์ทุกครั้งที่ service restart ~15 นาที)

const { v2: cloudinary } = require("cloudinary");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const multer = require("multer");

if (!process.env.CLOUDINARY_CLOUD_NAME) {
  throw new Error("CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET is required");
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

// สร้าง multer storage สำหรับใช้กับแต่ละประเภทไฟล์
// - folder: โฟลเดอร์บน Cloudinary (แยก avatars/products/lessons ให้จัดการง่าย)
// - allowedFormats: จำกัดประเภทไฟล์ที่รับ (PDF ต้องเปิดผ่าน resource_type: "raw" เพราะไม่ใช่รูป)
function makeStorage({ folder, allowedFormats }) {
  return new CloudinaryStorage({
    cloudinary,
    params: async (req, file) => {
      const isPdf = file.mimetype === "application/pdf";
      return {
        folder,
        // PDF ต้องเป็น "raw" resource ไม่งั้น Cloudinary จะปฏิเสธ (image resource รับแค่รูป)
        resource_type: isPdf ? "raw" : "image",
        // ใช้ชื่อไฟล์แบบ timestamp + random กันชนกัน + ตัดอักษรพิเศษที่ Cloudinary ไม่รับ
        public_id: `${Date.now()}-${Math.round(Math.random() * 1e9)}`,
        allowed_formats: allowedFormats,
      };
    },
  });
}

const AVATAR_ALLOWED = ["png", "jpg", "jpeg", "webp", "gif"];
const UPLOAD_ALLOWED = ["png", "jpg", "jpeg", "webp", "gif", "pdf"];

const avatarUpload = multer({
  storage: makeStorage({ folder: "reading-buddy/avatars", allowedFormats: AVATAR_ALLOWED }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// อัปโหลดของแอดมิน (รูปสินค้า / รูปบทเรียน / PDF บทเรียน)
// folder เลือกจาก query ?type=product|lesson ที่ route ส่งมา
function makeAdminUpload(folderResolver) {
  return multer({
    storage: new CloudinaryStorage({
      cloudinary,
      params: async (req, file) => {
        const isPdf = file.mimetype === "application/pdf";
        return {
          folder: folderResolver(req),
          resource_type: isPdf ? "raw" : "image",
          public_id: `${Date.now()}-${Math.round(Math.random() * 1e9)}`,
          allowed_formats: UPLOAD_ALLOWED,
        };
      },
    }),
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  });
}

module.exports = {
  cloudinary,
  avatarUpload,
  makeAdminUpload,
};
