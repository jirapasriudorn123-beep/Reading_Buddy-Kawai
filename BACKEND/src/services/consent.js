const db = require("../db/database");

// ================== ความยินยอมตาม PDPA ==================
// 1) ยอมรับนโยบายความเป็นส่วนตัว (บังคับ ถึงจะใช้งานระบบได้) — เก็บฉบับที่ยอมรับใน users.consent_version
// 2) ยินยอมให้ใช้ข้อมูลการใช้งานแบบไม่ระบุตัวตนเพื่อการวิจัย (ไม่บังคับ ถอนได้ทุกเมื่อในหน้าตั้งค่า)
//    ไม่ยินยอม = ข้อมูลของคนนั้นไม่อยู่ในไฟล์ CSV ข้อมูลวิจัยที่แอดมินส่งออก (services/researchExport.js)
// ทุกครั้งที่ยอมรับ/เปลี่ยนใจ บันทึกลง consent_log ไว้เป็นหลักฐาน
// แก้เนื้อหานโยบาย (FRONTEND/privacy.html) อย่างมีนัยสำคัญ → เพิ่ม CURRENT_CONSENT_VERSION ผู้ใช้ทุกคนจะถูกขอความยินยอมใหม่

const CURRENT_CONSENT_VERSION = 1;

async function recordConsent(userId, { research, source }) {
  const researchFlag = research ? 1 : 0;
  await db.tx(async (t) => {
    await t
      .prepare(
        `UPDATE users SET consent_version = ?, consent_at = datetime('now'),
           research_consent_at = CASE WHEN research_consent != ? OR research_consent_at IS NULL THEN datetime('now') ELSE research_consent_at END,
           research_consent = ?
         WHERE id = ?`
      )
      .run(CURRENT_CONSENT_VERSION, researchFlag, researchFlag, userId);
    await t
      .prepare("INSERT INTO consent_log (user_id, version, research_consent, source) VALUES (?, ?, ?, ?)")
      .run(userId, CURRENT_CONSENT_VERSION, researchFlag, source);
  });
}

function consentStatus(user) {
  return {
    version: user.consent_version ?? null,
    currentVersion: CURRENT_CONSENT_VERSION,
    needed: !user.consent_version || user.consent_version < CURRENT_CONSENT_VERSION,
    research: !!user.research_consent,
  };
}

module.exports = { CURRENT_CONSENT_VERSION, recordConsent, consentStatus };
