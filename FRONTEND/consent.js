// ================== ขอความยินยอม (PDPA) สำหรับผู้ใช้เดิม ==================
// ผู้ใช้ที่สมัครก่อนมีระบบนี้ หรือยอมรับนโยบายฉบับเก่า → ขึ้นป๊อปอัปให้ยอมรับก่อนใช้งานต่อ (ปิดไม่ได้จนกว่าจะยอมรับ)
// ข้อแรกบังคับ (นโยบายความเป็นส่วนตัว) | ข้อสองเลือกได้ (ใช้ข้อมูลการใช้งานเพื่อการวิจัย ระบุด้วยชื่อผู้ใช้/รหัสนิสิต)
// สถานะมาจาก GET /api/auth/me → consent.needed ดู BACKEND/src/services/consent.js

(function () {
  const STYLE = `
    .consent-overlay { position: fixed; inset: 0; z-index: 2147483600; display: flex; align-items: center; justify-content: center;
      padding: 16px; background: rgba(20, 24, 30, 0.6); font-family: 'Kanit', sans-serif; }
    .consent-card { width: min(520px, 100%); max-height: calc(100vh - 32px); overflow-y: auto; background: #fffdf8; color: #2d2d2d;
      border-radius: 20px; padding: 26px 24px 22px; box-shadow: 0 16px 40px rgba(0,0,0,0.3); border: 3px solid #97bc62; }
    .consent-card h2 { margin: 0 0 6px; font-size: 22px; color: #4f7a24; }
    .consent-card p { margin: 0 0 10px; font-size: 15px; line-height: 1.6; }
    .consent-card ul { margin: 0 0 14px; padding-left: 20px; font-size: 14px; line-height: 1.6; }
    .consent-card a { color: #4f7a24; font-weight: 600; }
    .consent-option { display: flex; gap: 10px; align-items: flex-start; margin: 10px 0; font-size: 14px; line-height: 1.5; cursor: pointer; }
    .consent-option input { margin-top: 3px; width: 18px; height: 18px; flex-shrink: 0; accent-color: #97bc62; }
    .consent-option em { color: #777; font-style: normal; font-size: 13px; }
    .consent-submit { width: 100%; margin-top: 12px; padding: 12px; border: none; border-radius: 12px; background: #97bc62; color: #fff;
      font-family: inherit; font-size: 17px; font-weight: 600; cursor: pointer; box-shadow: 0 4px 0 #6f9440; }
    .consent-submit:disabled { opacity: 0.5; cursor: default; }
    .consent-error { color: #c0392b; font-size: 14px; margin-top: 8px; }
    html.dark-mode body .consent-card { background: #23282d; color: #eee; }
  `;

  async function api(path, options = {}) {
    const token = localStorage.getItem("token");
    const res = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(options.headers || {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || "เชื่อมต่อ server ไม่สำเร็จ");
    return data;
  }

  function showConsentPrompt() {
    const style = document.createElement("style");
    style.textContent = STYLE;
    document.head.appendChild(style);

    const overlay = document.createElement("div");
    overlay.className = "consent-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "consentTitle");
    overlay.innerHTML = `
      <div class="consent-card">
        <h2 id="consentTitle">ขอความยินยอมการใช้ข้อมูล 🐾</h2>
        <p>Reading Buddy เก็บข้อมูลการใช้งานของคุณเพื่อให้ระบบทำงาน เช่น</p>
        <ul>
          <li>เวลาอ่าน หน้าที่เปิดอ่าน และคะแนนแบบทดสอบ</li>
          <li>การดูแลน้องหมา การเล่นเกม การซื้อของ และคำถามที่ถาม AI</li>
        </ul>
        <p>อ่านรายละเอียดได้ที่ <a href="privacy.html" target="_blank" rel="noopener">นโยบายความเป็นส่วนตัว</a></p>
        <label class="consent-option">
          <input type="checkbox" id="consentTerms">
          <span>ฉันได้อ่านและยอมรับนโยบายความเป็นส่วนตัว <em>(จำเป็นเพื่อใช้งานต่อ)</em></span>
        </label>
        <label class="consent-option">
          <input type="checkbox" id="consentResearch">
          <span>ยินยอมให้ใช้ข้อมูลการใช้งานของฉันเพื่อการวิจัย (ระบุด้วยชื่อผู้ใช้/รหัสนิสิต) <em>(ไม่บังคับ เปลี่ยนใจได้ที่หน้าตั้งค่า)</em></span>
        </label>
        <button type="button" class="consent-submit" id="consentSubmit" disabled>ยืนยันและใช้งานต่อ</button>
        <div class="consent-error" id="consentError" role="alert"></div>
      </div>`;
    document.body.appendChild(overlay);

    const terms = overlay.querySelector("#consentTerms");
    const submit = overlay.querySelector("#consentSubmit");
    terms.addEventListener("change", () => (submit.disabled = !terms.checked));
    submit.addEventListener("click", async () => {
      submit.disabled = true;
      try {
        await api("/auth/consent", {
          method: "POST",
          body: JSON.stringify({
            acceptTerms: true,
            research: overlay.querySelector("#consentResearch").checked,
            source: "prompt",
          }),
        });
        overlay.remove();
      } catch (err) {
        overlay.querySelector("#consentError").textContent = err.message;
        submit.disabled = !terms.checked;
      }
    });
  }

  async function checkConsent() {
    if (!localStorage.getItem("token")) return;
    try {
      const data = await api("/auth/me");
      if (data.consent && data.consent.needed) showConsentPrompt();
    } catch (_) {
      // token หมดอายุ/เชื่อมต่อไม่ได้ — หน้านั้นจัดการเอง
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", checkConsent);
  else checkConsent();
})();
