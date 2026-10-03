const nodemailer = require("nodemailer");

// ================== ช่องทางส่งอีเมล ==================
// 1) BREVO_API_KEY ตั้งไว้ → ส่งผ่าน Brevo HTTP API (ใช้บน Render: แพ็กเกจฟรีบล็อกพอร์ต SMTP ส่ง Gmail ตรงๆ แล้ว timeout)
// 2) ไม่มี → ส่งผ่าน Gmail SMTP ด้วย EMAIL_USER + EMAIL_APP_PASSWORD (ใช้ตอนรันในเครื่อง)
// ผู้ส่งคือ EMAIL_USER ทั้งสองแบบ (ใช้ Brevo ต้องยืนยันอีเมลนี้เป็น sender ใน Brevo ก่อน)
const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";
const SENDER_NAME = "webapp_for_reading";

let transporter = null;

// สร้าง transporter แบบ lazy (สร้างครั้งแรกที่ใช้งานเท่านั้น)
function getTransporter() {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_APP_PASSWORD, // ต้องเป็น Gmail App Password 16 หลัก ไม่ใช่รหัสผ่านปกติ
    },
  });

  return transporter;
}

async function sendViaBrevo({ to, subject, text, html }) {
  const response = await fetch(BREVO_API_URL, {
    method: "POST",
    headers: {
      "api-key": process.env.BREVO_API_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender: { name: SENDER_NAME, email: process.env.EMAIL_USER },
      to: [{ email: to }],
      subject,
      textContent: text,
      htmlContent: html,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const err = new Error(`Brevo API ${response.status}: ${detail.slice(0, 300)}`);
    err.code = "BREVO_SEND_FAILED";
    throw err;
  }
}

// throw error ชื่อ "EMAIL_NOT_CONFIGURED" ถ้ายังไม่ได้ตั้งค่าช่องทางส่งอีเมลเลย
async function deliver(message) {
  if (!process.env.EMAIL_USER) {
    const err = new Error("EMAIL_NOT_CONFIGURED");
    err.code = "EMAIL_NOT_CONFIGURED";
    throw err;
  }
  if (process.env.BREVO_API_KEY) {
    return sendViaBrevo(message);
  }
  if (!process.env.EMAIL_APP_PASSWORD) {
    const err = new Error("EMAIL_NOT_CONFIGURED");
    err.code = "EMAIL_NOT_CONFIGURED";
    throw err;
  }
  await getTransporter().sendMail({
    from: `"${SENDER_NAME}" <${process.env.EMAIL_USER}>`,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
}

// ส่งอีเมลลิงก์รีเซ็ตรหัสผ่าน
async function sendPasswordResetEmail(toEmail, resetUrl) {
  await deliver({
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

// ส่งอีเมลลิงก์ยืนยันอีเมลมหาวิทยาลัย (ต้องยืนยันก่อนแลกคูปองส่วนลด)
async function sendUnivVerificationEmail(toEmail, verifyUrl) {
  await deliver({
    to: toEmail,
    subject: "ยืนยันอีเมลมหาวิทยาลัยเพื่อแลกคูปอง",
    text:
      `กดลิงก์นี้เพื่อยืนยันอีเมลมหาวิทยาลัยของคุณ (หมดอายุใน 30 นาที):\n${verifyUrl}\n\n` +
      `ยืนยันแล้วจะแลกคูปองส่วนลดได้ อีเมล 1 อีเมลใช้ยืนยันได้ 1 บัญชีเท่านั้น\n` +
      `หากคุณไม่ได้เป็นคนขอ สามารถละเว้นอีเมลนี้ได้`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #333;">
        <h2 style="color:#1a1a1a;">ยืนยันอีเมลมหาวิทยาลัย</h2>
        <p>กดปุ่มด้านล่างเพื่อยืนยันอีเมลนี้ ยืนยันแล้วจะแลกคูปองส่วนลดในร้านค้าได้</p>
        <p style="margin: 24px 0;">
          <a href="${verifyUrl}"
             style="background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:8px;
                    text-decoration:none;display:inline-block;font-weight:bold;">
            ยืนยันอีเมล
          </a>
        </p>
        <p style="font-size: 13px; color:#666;">ลิงก์นี้จะหมดอายุภายใน 30 นาที อีเมล 1 อีเมลใช้ยืนยันได้ 1 บัญชีเท่านั้น</p>
        <p style="font-size: 13px; color:#666;">หากปุ่มด้านบนกดไม่ได้ ให้คัดลอกลิงก์นี้ไปเปิดในเบราว์เซอร์:</p>
        <p style="word-break: break-all; font-size: 13px; color:#4f46e5;">${verifyUrl}</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
        <p style="font-size: 12px; color:#999;">หากคุณไม่ได้เป็นคนขอ สามารถละเว้นอีเมลฉบับนี้ได้</p>
      </div>
    `,
  });
}

module.exports = { sendPasswordResetEmail, sendUnivVerificationEmail };
