const nodemailer = require("nodemailer");

let transporter = null;

// สร้าง transporter แบบ lazy (สร้างครั้งแรกที่ใช้งานเท่านั้น)
// ถ้ายังไม่ได้ตั้งค่า EMAIL_USER / EMAIL_APP_PASSWORD ใน .env จะคืนค่า null
function getTransporter() {
  if (transporter) return transporter;

  if (!process.env.EMAIL_USER || !process.env.EMAIL_APP_PASSWORD) {
    return null;
  }

  transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_APP_PASSWORD, // ต้องเป็น Gmail App Password 16 หลัก ไม่ใช่รหัสผ่านปกติ
    },
  });

  return transporter;
}

// ส่งอีเมลลิงก์รีเซ็ตรหัสผ่าน
// throw error ชื่อ "EMAIL_NOT_CONFIGURED" ถ้ายังไม่ได้ตั้งค่า .env
async function sendPasswordResetEmail(toEmail, resetUrl) {
  const t = getTransporter();

  if (!t) {
    const err = new Error("EMAIL_NOT_CONFIGURED");
    err.code = "EMAIL_NOT_CONFIGURED";
    throw err;
  }

  await t.sendMail({
    from: `"webapp_for_reading" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: "รีเซ็ตรหัสผ่านของคุณ",
    text:
      `คุณได้ขอรีเซ็ตรหัสผ่านสำหรับบัญชีนี้\n\n` +
      `กดลิงก์นี้เพื่อตั้งรหัสผ่านใหม่ (หมดอายุใน 15 นาที):\n${resetUrl}\n\n` +
      `หากคุณไม่ได้เป็นคนขอรีเซ็ตรหัสผ่าน สามารถละเว้นอีเมลนี้ได้`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #333;">
        <h2 style="color:#1a1a1a;">รีเซ็ตรหัสผ่าน</h2>
        <p>คุณได้ขอรีเซ็ตรหัสผ่านสำหรับบัญชีนี้ กดปุ่มด้านล่างเพื่อตั้งรหัสผ่านใหม่</p>
        <p style="margin: 24px 0;">
          <a href="${resetUrl}"
             style="background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:8px;
                    text-decoration:none;display:inline-block;font-weight:bold;">
            ตั้งรหัสผ่านใหม่
          </a>
        </p>
        <p style="font-size: 13px; color:#666;">ลิงก์นี้จะหมดอายุภายใน 15 นาที</p>
        <p style="font-size: 13px; color:#666;">หากปุ่มด้านบนกดไม่ได้ ให้คัดลอกลิงก์นี้ไปเปิดในเบราว์เซอร์:</p>
        <p style="word-break: break-all; font-size: 13px; color:#4f46e5;">${resetUrl}</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
        <p style="font-size: 12px; color:#999;">
          หากคุณไม่ได้เป็นคนขอรีเซ็ตรหัสผ่าน สามารถละเว้นอีเมลฉบับนี้ได้ ไม่มีการเปลี่ยนแปลงใดๆ เกิดขึ้นกับบัญชีของคุณ
        </p>
      </div>
    `,
  });
}

module.exports = { sendPasswordResetEmail };
