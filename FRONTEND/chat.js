// แชทบอทน้องหมา — สร้างปุ่มลอย + หน้าต่างแชทเองอัตโนมัติ ไม่ต้องแก้ HTML เพิ่ม
// ใช้ได้ทุกหน้าที่แปะ <script src="chat.js"> ไว้ (ต้องมี config.js โหลดไว้ก่อนเสมอ)
(function () {
  function getToken() {
    return localStorage.getItem("token");
  }

  let chatHistory = []; // [{ role: "user" | "assistant", content: string }]
  let isOpen = false;
  let isSending = false;

  // ================== เรียก backend ==================

  async function sendChatMessage(message) {
    const token = getToken();
    const chapterId = window.currentReadingChapterId || null;

    const response = await fetch(`${API_BASE_URL}/chat/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ message, chapterId, history: chatHistory }),
    });

    const data = await response.json().catch(() => ({}));

    if (response.status === 401) {
      localStorage.removeItem("token");
      localStorage.removeItem("currentUser");
      window.location.href = "login.html";
      throw new Error("Unauthorized");
    }

    if (!response.ok) {
      throw new Error(data.message || "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
    }

    return data.reply;
  }

  // ================== สร้าง widget ==================

  function createWidget() {
    if (document.getElementById("chatBubbleBtn")) return; // กันสร้างซ้ำ

    const bubble = document.createElement("button");
    bubble.id = "chatBubbleBtn";
    bubble.type = "button";
    bubble.setAttribute("aria-label", "เปิดแชทกับน้องหมา");
    bubble.textContent = "🐶";
    bubble.addEventListener("click", toggleChat);
    document.body.appendChild(bubble);

    const panel = document.createElement("div");
    panel.id = "chatPanel";
    panel.innerHTML = `
      <div class="chat-panel-header">
        <span>🐶 แชทกับน้องหมา</span>
        <button type="button" id="chatCloseBtn" aria-label="ปิดแชท">×</button>
      </div>
      <div class="chat-panel-messages" id="chatMessages"></div>
      <form class="chat-panel-input-row" id="chatForm">
        <input type="text" id="chatInput" placeholder="พิมพ์คำถามที่นี่..." autocomplete="off">
        <button type="submit" aria-label="ส่งข้อความ">➤</button>
      </form>
    `;
    document.body.appendChild(panel);

    document.getElementById("chatCloseBtn").addEventListener("click", toggleChat);
    document.getElementById("chatForm").addEventListener("submit", onSubmit);

    appendMessage("bot", "สวัสดีครับ! ผมน้องหมา ผู้ช่วยตอบคำถามเรื่องบทเรียนและเกี่ยวกับน้องหมา 📖 มีอะไรให้ช่วยไหมครับ 🐾");
  }

  function toggleChat() {
    isOpen = !isOpen;
    document.getElementById("chatPanel").classList.toggle("open", isOpen);
    if (isOpen) document.getElementById("chatInput").focus();
  }

  // ================== ข้อความในแชท ==================

  function appendMessage(role, text) {
    const messagesEl = document.getElementById("chatMessages");
    const bubbleEl = document.createElement("div");
    bubbleEl.className = `chat-message chat-message-${role}`;
    bubbleEl.textContent = text;
    messagesEl.appendChild(bubbleEl);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return bubbleEl;
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (isSending) return;

    const input = document.getElementById("chatInput");
    const message = input.value.trim();
    if (!message) return;

    input.value = "";
    appendMessage("user", message);

    isSending = true;
    const typingEl = appendMessage("bot", "กำลังพิมพ์...");
    typingEl.classList.add("chat-message-typing");

    try {
      const reply = await sendChatMessage(message);
      typingEl.remove();
      appendMessage("bot", reply);
      chatHistory.push({ role: "user", content: message });
      chatHistory.push({ role: "assistant", content: reply });
    } catch (err) {
      typingEl.remove();
      appendMessage("bot", "❌ " + err.message);
    } finally {
      isSending = false;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!getToken()) return; // ไม่ login ไม่ต้องโชว์แชท (เช่นหน้า login/register)
    createWidget();
  });
})();
