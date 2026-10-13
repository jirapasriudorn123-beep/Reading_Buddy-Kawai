const { GoogleGenerativeAI } = require("@google/generative-ai");

// ================== ตัวเรียก Google Gemini (ใช้ทุกที่ที่ระบบเรียก AI) ==================
// แยก "กฎ/บทบาทของ AI" (systemInstruction) ออกจากข้อความผู้ใช้ — ผู้ใช้พิมพ์สั่งเปลี่ยนบทบาทได้ยากกว่าใส่ทุกอย่างรวมใน prompt เดียว
// ตั้งค่าการสร้างคำตอบให้คงที่และตรวจสอบได้ (temperature ต่ำ = ตอบสม่ำเสมอ แต่งเรื่องน้อยลง, จำกัดความยาว = คุมค่าใช้จ่าย)

const MODEL_NAME = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";

// ค่าเริ่มต้น — แต่ละงานส่งค่าเฉพาะมาทับได้ (เช่น สรุปการอ่านใช้ temperature ต่ำกว่าแชท)
const DEFAULT_GENERATION_CONFIG = {
  temperature: 0.3,
  topP: 0.9,
  maxOutputTokens: 800,
};

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// คืน { text, latencyMs, finishReason, usage } — โยน error ถ้า Gemini ตอบไม่ได้ (คนเรียกเป็นคนตัดสินว่าจะ fallback อย่างไร)
async function generate({ systemInstruction, prompt, generationConfig = {} }) {
  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    systemInstruction,
    generationConfig: { ...DEFAULT_GENERATION_CONFIG, ...generationConfig },
  });
  const startedAt = Date.now();
  try {
    const result = await model.generateContent(prompt);
    const candidate = result.response.candidates && result.response.candidates[0];
    return {
      text: result.response.text(),
      latencyMs: Date.now() - startedAt,
      finishReason: candidate ? candidate.finishReason : null,
      usage: result.response.usageMetadata || null,
    };
  } catch (error) {
    console.error("Gemini API Error:", error);
    throw error;
  }
}

module.exports = {
  MODEL_NAME,
  DEFAULT_GENERATION_CONFIG,
  generate,
};
