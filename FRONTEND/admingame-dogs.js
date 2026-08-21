// ================== หน้าจัดการคำถามเกี่ยวกับพันธุ์สุนัข ==================
// ใช้ในด่าน 2, 4 ของทุกโลกในเกม แต่ละพันธุ์มี pool คำถามของตัวเอง

const BREED_LABEL = {
  golden: "🦮 โกลเด้นรีทรีฟเวอร์",
  shiba: "🐕 ชิบะอินุ",
  siberian: "🐺 ไซบีเรียนฮัสกี้",
  thairidgeback: "🐶 ไทยหลังอาน",
};

let currentBreed = new URLSearchParams(location.search).get("breed") || "golden";
let currentQuestions = [];
let editingQuestionId = null;
let currentStageFilter = "all";

// Dropdown สลับหมวด: กลับไปหน้ารายชื่อบท / อยู่หน้าเกี่ยวกับสุนัข (เหมือน admingame-edit.js)
function populateChapterNav() {
  const select = document.getElementById("chapterNav");
  if (!select) return;
  select.innerHTML =
    '<option value="all">วิชาสถาปัตย์คอมฯ</option>' +
    '<option value="dogs">เกี่ยวกับสุนัข</option>';
  select.value = "dogs";
}

function onChapterNavChange(value) {
  if (value === "all") {
    window.location.href = "admingame.html";
  }
}

async function loadQuestions() {
  try {
    const { questions } = await adminApiFetch(`/admin/breed-questions?breed=${currentBreed}`);
    currentQuestions = questions;
    renderQuestions();
  } catch (err) {
    console.error("โหลดคำถามไม่สำเร็จ:", err);
    document.getElementById("questionList").innerHTML =
      '<p style="color:#d9534f; text-align:center; padding:40px;">โหลดคำถามไม่สำเร็จ</p>';
  }
}

function renderQuestions() {
  const wrap = document.getElementById("questionList");
  const filtered =
    currentStageFilter === "all"
      ? currentQuestions
      : currentQuestions.filter((q) => q.stage === Number(currentStageFilter));

  if (!filtered.length) {
    wrap.innerHTML =
      `<p style="color:#999; text-align:center; padding:40px;">ยังไม่มีคำถามสำหรับ ${escapeHtml(BREED_LABEL[currentBreed])}<br>กด "+ เพิ่มคำถาม" เพื่อเริ่มสร้างได้เลย</p>`;
    return;
  }

  wrap.innerHTML = filtered
    .map((q, idx) => {
      const options = [q.option_1, q.option_2, q.option_3, q.option_4];
      return `
      <div class="qe-q-card ${q.enabled ? "" : "disabled"}">
        <div class="qe-q-header">
          <div class="qe-q-header-left">
            <span class="qe-lv-badge">ด่านที่ ${q.stage}</span>
            <span class="qe-lv-badge">${escapeHtml(BREED_LABEL[currentBreed]).split(" ")[0]}</span>
            <p class="qe-q-title">คำถามที่ ${idx + 1}</p>
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

// เลือกพันธุ์ใหม่ → reload URL query (คำถามต่างชุด)
function onBreedChange(newBreed) {
  if (newBreed !== currentBreed) {
    window.location.href = `admingame-dogs.html?breed=${newBreed}`;
  }
}

function openAddQuestionModal() {
  editingQuestionId = null;
  document.getElementById("questionModalTitle").textContent = `เพิ่มคำถาม — ${BREED_LABEL[currentBreed]}`;
  document.getElementById("editQuestionId").value = "";
  document.getElementById("editQuestionStage").value = currentStageFilter !== "all" ? currentStageFilter : "2";
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
  document.getElementById("editQuestionStage").value = q.stage;
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
  const question = document.getElementById("editQuestionText").value.trim();
  const options = [1, 2, 3, 4].map((i) => document.getElementById("editOption" + i).value.trim());
  const correctRadio = document.querySelector('input[name="correctOption"]:checked');

  if (!question) return alert("กรุณากรอกคำถาม");
  if (options.some((o) => !o)) return alert("กรุณากรอกตัวเลือกให้ครบทั้ง 4 ข้อ");
  if (!correctRadio) return alert("กรุณาเลือกคำตอบที่ถูก");

  const payload = {
    breed: currentBreed,
    stage: Number(document.getElementById("editQuestionStage").value),
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
      await adminApiFetch(`/admin/breed-questions/${editingQuestionId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
    } else {
      await adminApiFetch("/admin/breed-questions", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    }
    closeQuestionModal();
    await loadQuestions();
  } catch (err) {
    alert("บันทึกไม่สำเร็จ: " + err.message);
  } finally {
    btn.disabled = false;
  }
}

async function toggleQuestionEnabled(id) {
  try {
    await adminApiFetch(`/admin/breed-questions/${id}/toggle`, { method: "PATCH" });
    await loadQuestions();
  } catch (err) {
    alert("อัปเดตไม่สำเร็จ: " + err.message);
  }
}

async function deleteQuestion(id) {
  if (!confirm("ลบคำถามนี้แน่ใจไหม?")) return;
  try {
    await adminApiFetch(`/admin/breed-questions/${id}`, { method: "DELETE" });
    await loadQuestions();
  } catch (err) {
    alert("ลบไม่สำเร็จ: " + err.message);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (!getAdminToken()) return;
  populateChapterNav();
  const sel = document.getElementById("breedNav");
  if (sel) sel.value = currentBreed;
  document.getElementById("stageFilter").onchange = (e) => {
    currentStageFilter = e.target.value;
    renderQuestions();
  };
  loadQuestions();

  document.getElementById("questionModal").addEventListener("click", function (e) {
    if (e.target === this) closeQuestionModal();
  });
});
