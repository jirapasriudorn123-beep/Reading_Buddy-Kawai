// ================== หน้าจัดการคำถามในมินิเกม (per chapter) ==================
// เข้ามาที่ admingame-edit.html?chapterId=1 → โหลด chapter + questions ของ chapter นั้น

const chapterId = Number(new URLSearchParams(location.search).get("chapterId"));
let currentChapter = null;
let currentQuestions = [];
let currentLevelFilter = "all";
let editingQuestionId = null;

async function loadPage() {
  if (!chapterId) {
    document.getElementById("questionList").innerHTML =
      '<p style="color:#d9534f; text-align:center; padding:40px;">ไม่พบบทเรียนที่ต้องการแก้ไข <a href="admingame.html">กลับหน้าจัดการมินิเกม</a></p>';
    return;
  }
  try {
    // Dropdown ตอนนี้ไม่ต้องรายชื่อบทแล้ว (เหลือแค่ "วิชา + เกี่ยวกับสุนัข") — ไม่ต้อง fetch chapters เพิ่ม
    const main = await adminApiFetch(`/admin/game-questions/chapter/${chapterId}`);
    currentChapter = main.chapter;
    currentQuestions = main.questions;
    renderConditionBar();
    renderLevelFilter();
    renderQuestions();
    populateChapterNav();
  } catch (err) {
    console.error("โหลดข้อมูลไม่สำเร็จ:", err);
    document.getElementById("questionList").innerHTML =
      '<p style="color:#d9534f; text-align:center; padding:40px;">โหลดข้อมูลไม่สำเร็จ</p>';
  }
}

// เติมรายชื่อบทลง dropdown สลับบท + set default ไปที่บทปัจจุบัน
// Dropdown สลับหมวด: "← วิชาสถาปัตย์คอมฯ" กลับหน้ารายชื่อบท / "เกี่ยวกับสุนัข" ยังไม่พร้อม
// การสลับระหว่างบท ใช้กลับหน้ารายชื่อบทแล้วเลือกใหม่ (ไม่ได้อยู่ใน dropdown แล้ว)
function populateChapterNav(_chapters) {
  const select = document.getElementById("chapterNav");
  if (!select) return;
  select.innerHTML =
    '<option value="all">← วิชาสถาปัตย์คอมฯ</option>' +
    '<option value="dogs">เกี่ยวกับสุนัข</option>';
  select.value = "all";
}

function onChapterNavChange(value) {
  if (value === "all") {
    window.location.href = "admingame.html";
  } else if (value === "dogs") {
    alert("หน้าจัดการคำถาม 'เกี่ยวกับสุนัข' ยังอยู่ระหว่างเตรียม 🐕");
    const sel = document.getElementById("chapterNav");
    if (sel) sel.value = "all";
  }
}

function renderConditionBar() {
  document.getElementById("conditionText").textContent =
    `บทที่ ${currentChapter.chapter_number} ${currentChapter.title} : ` +
    `ต้องอ่านบทเรียน ${currentChapter.game_required_minutes} นาที | ` +
    `คำถาม: ${currentChapter.game_question_count} ข้อ`;
}

function renderLevelFilter() {
  const levels = Array.from(new Set(currentQuestions.map((q) => q.level))).sort((a, b) => a - b);
  const select = document.getElementById("levelFilter");
  select.innerHTML =
    '<option value="all">ทุกเลเวล</option>' +
    levels.map((lv) => `<option value="${lv}">Level ${lv}</option>`).join("");
  select.value = currentLevelFilter;
  select.onchange = (e) => {
    currentLevelFilter = e.target.value;
    renderQuestions();
  };
}

function renderQuestions() {
  const wrap = document.getElementById("questionList");
  const filtered =
    currentLevelFilter === "all"
      ? currentQuestions
      : currentQuestions.filter((q) => q.level === Number(currentLevelFilter));

  if (!filtered.length) {
    wrap.innerHTML =
      '<p style="color:#999; text-align:center; padding:40px;">ยังไม่มีคำถาม กด "+ เพิ่มคำถาม" เพื่อเริ่มสร้างได้เลย</p>';
    return;
  }

  wrap.innerHTML = filtered
    .map((q, idx) => {
      const options = [q.option_1, q.option_2, q.option_3, q.option_4];
      return `
      <div class="qe-q-card ${q.enabled ? "" : "disabled"}">
        <div class="qe-q-header">
          <div class="qe-q-header-left">
            <span class="qe-lv-badge">LV${q.level}</span>
            <p class="qe-q-title">คำถามที่ ${idx + 1} : ${escapeHtml(currentChapter.title)}</p>
          </div>
          <div class="qe-q-header-right">
            <button class="game-status-pill ${q.enabled ? "" : "off"}"
                    onclick="toggleQuestionEnabled(${q.id})"
                    title="${q.enabled ? "คลิกเพื่อปิดใช้งาน" : "คลิกเพื่อเปิดใช้งาน"}">
              ${q.enabled ? "เปิดใช้งานอยู่" : "ปิดใช้งาน"}
            </button>
            <button class="game-card-edit" onclick="openEditQuestionModal(${q.id})" title="แก้ไข">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f0b23d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
              </svg>
            </button>
            <button class="game-card-delete" onclick="deleteQuestion(${q.id})" title="ลบ">✕</button>
          </div>
        </div>
        <p class="qe-q-question">${escapeHtml(q.question)}</p>
        <div class="qe-q-options">
          ${options
            .map(
              (opt, i) =>
                `<div class="qe-q-option ${q.correct_option === i + 1 ? "correct" : ""}">${escapeHtml(opt)}</div>`
            )
            .join("")}
        </div>
      </div>`;
    })
    .join("");
}

// ---- Modal คำถาม (add/edit) ----
function openAddQuestionModal() {
  editingQuestionId = null;
  document.getElementById("questionModalTitle").textContent = "เพิ่มคำถาม";
  document.getElementById("editQuestionId").value = "";
  document.getElementById("editQuestionLevel").value = 1;
  document.getElementById("editQuestionText").value = "";
  [1, 2, 3, 4].forEach((i) => {
    document.getElementById("editOption" + i).value = "";
    document.getElementById("correctOpt" + i).checked = false;
  });
  document.getElementById("correctOpt1").checked = true;
  document.getElementById("questionModal").classList.add("active");
}

function openEditQuestionModal(id) {
  const q = currentQuestions.find((x) => x.id === id);
  if (!q) return;
  editingQuestionId = id;
  document.getElementById("questionModalTitle").textContent = "แก้ไขคำถาม";
  document.getElementById("editQuestionId").value = id;
  document.getElementById("editQuestionLevel").value = q.level;
  document.getElementById("editQuestionText").value = q.question;
  document.getElementById("editOption1").value = q.option_1;
  document.getElementById("editOption2").value = q.option_2;
  document.getElementById("editOption3").value = q.option_3;
  document.getElementById("editOption4").value = q.option_4;
  [1, 2, 3, 4].forEach((i) => {
    document.getElementById("correctOpt" + i).checked = q.correct_option === i;
  });
  document.getElementById("questionModal").classList.add("active");
}

function closeQuestionModal() {
  document.getElementById("questionModal").classList.remove("active");
}

async function saveQuestion() {
  const level = Number(document.getElementById("editQuestionLevel").value);
  const question = document.getElementById("editQuestionText").value.trim();
  const options = [1, 2, 3, 4].map((i) => document.getElementById("editOption" + i).value.trim());
  const correctRadio = document.querySelector('input[name="correctOption"]:checked');

  if (!question) return alert("กรุณากรอกคำถาม");
  if (options.some((o) => !o)) return alert("กรุณากรอกตัวเลือกให้ครบทั้ง 4 ข้อ");
  if (!correctRadio) return alert("กรุณาเลือกคำตอบที่ถูก");

  const payload = {
    chapterId,
    level,
    question,
    option_1: options[0],
    option_2: options[1],
    option_3: options[2],
    option_4: options[3],
    correctOption: Number(correctRadio.value),
  };

  const btn = document.querySelector("#questionModal .edit-confirm-btn");
  btn.disabled = true;

  try {
    if (editingQuestionId) {
      await adminApiFetch(`/admin/game-questions/${editingQuestionId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
    } else {
      await adminApiFetch("/admin/game-questions", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    }
    closeQuestionModal();
    await loadPage();
  } catch (err) {
    alert("บันทึกไม่สำเร็จ: " + err.message);
  } finally {
    btn.disabled = false;
  }
}

async function toggleQuestionEnabled(id) {
  try {
    await adminApiFetch(`/admin/game-questions/${id}/toggle`, { method: "PATCH" });
    await loadPage();
  } catch (err) {
    alert("อัปเดตไม่สำเร็จ: " + err.message);
  }
}

async function deleteQuestion(id) {
  if (!confirm("ลบคำถามนี้แน่ใจไหม?")) return;
  try {
    await adminApiFetch(`/admin/game-questions/${id}`, { method: "DELETE" });
    await loadPage();
  } catch (err) {
    alert("ลบไม่สำเร็จ: " + err.message);
  }
}

// ---- Modal แก้เงื่อนไขบท (reading time + num questions) ----
function openChapterConfigModal() {
  if (!currentChapter) return;
  document.getElementById("cfgRequiredMinutes").value = currentChapter.game_required_minutes;
  document.getElementById("cfgQuestionCount").value = currentChapter.game_question_count;
  document.getElementById("chapterConfigModal").classList.add("active");
}

function closeChapterConfigModal() {
  document.getElementById("chapterConfigModal").classList.remove("active");
}

async function saveChapterConfig() {
  const requiredMinutes = Number(document.getElementById("cfgRequiredMinutes").value);
  const questionCount = Number(document.getElementById("cfgQuestionCount").value);
  if (!Number.isInteger(requiredMinutes) || requiredMinutes < 0 || requiredMinutes > 240) {
    return alert("เวลาต้องเป็น 0-240 นาที");
  }
  if (!Number.isInteger(questionCount) || questionCount < 1 || questionCount > 50) {
    return alert("จำนวนคำถามต้องเป็น 1-50 ข้อ");
  }
  try {
    const { chapter } = await adminApiFetch(`/admin/game-config/${chapterId}`, {
      method: "PUT",
      body: JSON.stringify({ requiredMinutes, questionCount }),
    });
    currentChapter = { ...currentChapter, ...chapter };
    renderConditionBar();
    closeChapterConfigModal();
  } catch (err) {
    alert("บันทึกไม่สำเร็จ: " + err.message);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (!getAdminToken()) return;
  loadPage();

  // ปิด modal ด้วยการคลิกพื้นหลัง
  document.getElementById("questionModal").addEventListener("click", function (e) {
    if (e.target === this) closeQuestionModal();
  });
  document.getElementById("chapterConfigModal").addEventListener("click", function (e) {
    if (e.target === this) closeChapterConfigModal();
  });
});
