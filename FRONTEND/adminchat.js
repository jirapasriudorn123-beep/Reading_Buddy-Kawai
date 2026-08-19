// ================== หน้าจัดการคลังคำตอบแชทบอทน้องหมา ==================
// แอดมินหลายคนช่วยกันเพิ่ม/แก้/ลบคำตอบได้จากหน้านี้ ไม่ต้องแก้โค้ดแล้วรีสตาร์ทเซิร์ฟเวอร์

let currentAnswers = [];
let currentChapters = [];
let editingAnswerId = null; // null = โหมดเพิ่มใหม่

// ─── ตัวช่วย ──────────────────────────────────────────────────
// escapeHtml อยู่ใน adminAuth.js (โหลดก่อนไฟล์นี้เสมอ) ใช้ร่วมกันทุกหน้าแอดมิน

function truncate(text, max) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function chapterLabel(answer) {
  return answer.chapter_number ? `บทที่ ${answer.chapter_number}` : "คำตอบกลาง";
}

// ─── LOAD ─────────────────────────────────────────────────────
async function loadChapters() {
  const { chapters } = await adminApiFetch("/admin/chapters");
  currentChapters = chapters;

  const optionsHtml = chapters
    .map((c) => `<option value="${c.id}">บทที่ ${c.chapter_number} — ${escapeHtml(c.title)}</option>`)
    .join("");

  document.getElementById("answerChapter").innerHTML =
    `<option value="">ไม่ผูกกับบทไหน (คำตอบกลาง)</option>${optionsHtml}`;
  document.getElementById("chapterFilter").innerHTML =
    `<option value="all">ทุกบทเรียน</option><option value="none">คำตอบกลาง</option>${optionsHtml}`;
}

async function loadAnswers() {
  const { answers } = await adminApiFetch("/admin/chat-answers");
  currentAnswers = answers;
  updateTable();
}

// ─── RENDER ───────────────────────────────────────────────────
function getFilteredAnswers() {
  const chapterValue = document.getElementById("chapterFilter").value;
  const term = document.getElementById("searchInput").value.trim().toLowerCase();

  let list = currentAnswers;
  if (chapterValue === "none") {
    list = list.filter((a) => !a.chapter_id);
  } else if (chapterValue !== "all") {
    list = list.filter((a) => a.chapter_id === Number(chapterValue));
  }

  if (term) {
    list = list.filter(
      (a) => a.keywords.toLowerCase().includes(term) || a.answer.toLowerCase().includes(term)
    );
  }
  return list;
}

function updateTable() {
  const tbody = document.getElementById("answerTableBody");
  const list = getFilteredAnswers();

  if (!list.length) {
    const isEmpty = currentAnswers.length === 0;
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#999;padding:24px;">${
      isEmpty
        ? 'ยังไม่มีคำตอบในคลังเลย กด "+ เพิ่มคำตอบ" เพื่อเริ่มสอนน้องหมาได้เลย'
        : "ไม่พบคำตอบที่ตรงกับเงื่อนไข"
    }</td></tr>`;
    return;
  }

  tbody.innerHTML = list
    .map(
      (a) => `
      <tr>
        <td>${escapeHtml(chapterLabel(a))}</td>
        <td>${a.keywords
          .split(",")
          .map((k) => `<span class="keyword-chip">${escapeHtml(k.trim())}</span>`)
          .join(" ")}</td>
        <td>${escapeHtml(truncate(a.answer, 120))}</td>
        <td>${escapeHtml(a.created_by_name || "-")}</td>
        <td>
          <button class="edit-item-btn" style="width:auto;padding:6px 12px;" onclick="openEditModal(${a.id})">แก้ไข</button>
          <button class="delete-item-btn" style="width:auto;padding:6px 12px;" onclick="deleteAnswer(${a.id})">ลบ</button>
        </td>
      </tr>`
    )
    .join("");
}

// ─── ทดสอบคำถาม ──────────────────────────────────────────────
// ให้แอดมินลองพิมพ์คำถามดูว่าเข้าคำตอบไหน ก่อนปล่อยให้นักเรียนใช้จริง
async function runTest() {
  const input = document.getElementById("testInput");
  const resultEl = document.getElementById("testResult");
  const message = input.value.trim();

  if (!message) {
    resultEl.className = "chat-test-result";
    resultEl.textContent = "";
    return;
  }

  try {
    const match = await adminApiFetch("/admin/chat-answers/test", {
      method: "POST",
      body: JSON.stringify({ message }),
    });

    if (!match || !match.answer) {
      resultEl.className = "chat-test-result miss";
      resultEl.innerHTML =
        "❌ ยังไม่มีคำตอบไหนตรงกับคำถามนี้ — นักเรียนจะได้ข้อความว่าน้องหมายังไม่เข้าใจคำถาม<br>" +
        'ถ้าอยากให้ตอบได้ กด "+ เพิ่มคำตอบ" แล้วใส่คำสำคัญจากคำถามนี้เข้าไป';
      return;
    }

    resultEl.className = "chat-test-result hit";
    resultEl.innerHTML =
      `✅ ตรงกับคำสำคัญ <span class="keyword-chip">${escapeHtml(match.matchedKeyword)}</span>` +
      `${match.chapterNumber ? ` (บทที่ ${match.chapterNumber})` : " (คำตอบกลาง)"}<br><br>` +
      `<strong>น้องหมาจะตอบว่า:</strong><br>${escapeHtml(match.answer).replace(/\n/g, "<br>")}`;
  } catch (err) {
    resultEl.className = "chat-test-result miss";
    resultEl.textContent = "ทดสอบไม่สำเร็จ: " + err.message;
  }
}

// ─── ADD / EDIT MODAL ─────────────────────────────────────────
function openAddModal() {
  editingAnswerId = null;
  document.getElementById("answerChapter").value = "";
  document.getElementById("answerKeywords").value = "";
  document.getElementById("answerText").value = "";
  document.querySelector(".edit-modal-title").textContent = "เพิ่มคำตอบ";
  document.getElementById("editAnswerModal").classList.add("active");
}

function openEditModal(id) {
  const answer = currentAnswers.find((a) => a.id === id);
  if (!answer) return;

  editingAnswerId = id;
  document.getElementById("answerChapter").value = answer.chapter_id || "";
  document.getElementById("answerKeywords").value = answer.keywords;
  document.getElementById("answerText").value = answer.answer;
  document.querySelector(".edit-modal-title").textContent = "แก้ไขคำตอบ";
  document.getElementById("editAnswerModal").classList.add("active");
}

function closeEditModal() {
  document.getElementById("editAnswerModal").classList.remove("active");
}

async function saveAnswer() {
  const chapterId = document.getElementById("answerChapter").value;
  const keywords = document.getElementById("answerKeywords").value.trim();
  const answer = document.getElementById("answerText").value.trim();

  if (!keywords) {
    alert("กรุณากรอกคำสำคัญอย่างน้อย 1 คำ");
    return;
  }
  if (!answer) {
    alert("กรุณากรอกคำตอบ");
    return;
  }

  const confirmBtn = document.querySelector(".edit-confirm-btn");
  confirmBtn.disabled = true;

  try {
    const payload = { chapterId: chapterId || null, keywords, answer };

    if (editingAnswerId) {
      await adminApiFetch(`/admin/chat-answers/${editingAnswerId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
    } else {
      await adminApiFetch("/admin/chat-answers", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    }

    alert("✅ บันทึกเรียบร้อยแล้ว!");
    closeEditModal();
    await loadAnswers();
  } catch (err) {
    alert("เกิดข้อผิดพลาด: " + err.message);
  } finally {
    confirmBtn.disabled = false;
  }
}

async function deleteAnswer(id) {
  if (!confirm("ลบคำตอบนี้แน่ใจไหม? น้องหมาจะตอบคำถามที่เคยใช้คำตอบนี้ไม่ได้อีก")) return;
  try {
    await adminApiFetch(`/admin/chat-answers/${id}`, { method: "DELETE" });
    await loadAnswers();
  } catch (err) {
    alert("ลบไม่สำเร็จ: " + err.message);
  }
}

// ─── INIT ─────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  if (!getAdminToken()) return; // adminAuth.js จะเด้งไป login ให้แล้ว

  try {
    await loadChapters();
    await loadAnswers();
  } catch (err) {
    console.error("โหลดข้อมูลคลังคำตอบไม่สำเร็จ:", err);
    alert("โหลดข้อมูลคลังคำตอบไม่สำเร็จ: " + err.message);
  }

  document.getElementById("editAnswerModal").addEventListener("click", function (e) {
    if (e.target === this) closeEditModal();
  });

  document.getElementById("testInput").addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      runTest();
    }
  });
});
