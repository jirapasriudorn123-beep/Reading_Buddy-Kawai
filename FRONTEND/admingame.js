// ================== หน้าจัดการมินิเกม ==================
// แอดมินตั้งเงื่อนไข "ต้องอ่านกี่นาที + จำนวนคำถาม" และเปิด/ปิดใช้งาน มินิเกมของแต่ละบท

let currentChapters = [];

async function loadGameConfig() {
  try {
    const { chapters } = await adminApiFetch("/admin/game-config");
    currentChapters = chapters;
    renderGameCards();
  } catch (err) {
    console.error("โหลดค่ามินิเกมไม่สำเร็จ:", err);
    document.getElementById("gameCards").innerHTML =
      '<p style="color:#d9534f; text-align:center; padding:40px;">โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่</p>';
  }
}

function renderGameCards() {
  const wrap = document.getElementById("gameCards");
  if (!currentChapters.length) {
    wrap.innerHTML =
      '<p style="color:#999; text-align:center; padding:40px;">ยังไม่มีบทเรียน กรุณาเพิ่มบทเรียนที่หน้า "จัดการบทเรียน" ก่อน</p>';
    return;
  }

  wrap.innerHTML = currentChapters
    .map((ch) => {
      const enabled = !!ch.game_enabled;
      return `
      <div class="game-card ${enabled ? "" : "disabled"}">
        <div class="game-card-left">
          <span class="game-ch-badge">World ${ch.chapter_number}</span>
          <div class="game-card-info">
            <div class="game-card-conditions">
              เงื่อนไข : ต้องอ่านบทเรียน ${ch.game_required_minutes} นาที
              <span class="separator">|</span>
              คำถาม: ${ch.game_question_count} ข้อ
            </div>
          </div>
        </div>
        <div class="game-card-right">
          <button class="game-status-pill ${enabled ? "" : "off"}"
                  onclick="toggleEnabled(${ch.id})"
                  title="คลิกเพื่อ ${enabled ? "ปิด" : "เปิด"} ใช้งาน">
            ${enabled ? "เปิดใช้งานอยู่" : "ปิดใช้งาน"}
          </button>
          <button class="game-card-edit" onclick="goToQuestionEditor(${ch.id})" title="แก้ไขคำถาม / เงื่อนไข">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f0b23d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
          </button>
          <button class="game-card-delete" onclick="disableGame(${ch.id})" title="ปิดการใช้งาน">✕</button>
        </div>
      </div>`;
    })
    .join("");
}

// ---- Toggle enabled/disabled ----
async function toggleEnabled(id) {
  const chapter = currentChapters.find((c) => c.id === id);
  if (!chapter) return;
  try {
    const { chapter: updated } = await adminApiFetch(`/admin/game-config/${id}`, {
      method: "PUT",
      body: JSON.stringify({ enabled: !chapter.game_enabled }),
    });
    Object.assign(chapter, updated);
    renderGameCards();
  } catch (err) {
    alert("อัปเดตไม่สำเร็จ: " + err.message);
  }
}

// ปุ่ม X = ปิดใช้งาน (ไม่ลบบทเรียน)
async function disableGame(id) {
  const chapter = currentChapters.find((c) => c.id === id);
  if (!chapter) return;
  if (!chapter.game_enabled) return; // ปิดอยู่แล้ว
  if (!confirm(`ปิดใช้งานมินิเกมของ "${chapter.title}"? (ผู้ใช้จะเล่นบทนี้ไม่ได้)`)) return;
  try {
    const { chapter: updated } = await adminApiFetch(`/admin/game-config/${id}`, {
      method: "PUT",
      body: JSON.stringify({ enabled: false }),
    });
    Object.assign(chapter, updated);
    renderGameCards();
  } catch (err) {
    alert("อัปเดตไม่สำเร็จ: " + err.message);
  }
}

// นำทางไปหน้าจัดการคำถามของบทนั้น (admingame-edit.html รับ chapterId ทาง query string)
function goToQuestionEditor(id) {
  window.location.href = `admingame-edit.html?chapterId=${id}`;
}

// ---- Modal แก้ไขเงื่อนไขบท (คงไว้เผื่อ backend เดิมยังใช้) — ไม่ได้ผูกกับปุ่มไหนแล้ว ----
function openEditModal(id) {
  const chapter = currentChapters.find((c) => c.id === id);
  if (!chapter) return;
  document.getElementById("editChapterId").value = chapter.id;
  document.getElementById("editChapterTitle").textContent =
    `Chapter ${chapter.chapter_number} : ${chapter.title}`;
  document.getElementById("editRequiredMinutes").value = chapter.game_required_minutes;
  document.getElementById("editQuestionCount").value = chapter.game_question_count;
  document.getElementById("gameEditModal").classList.add("active");
}

function closeEditModal() {
  document.getElementById("gameEditModal").classList.remove("active");
}

async function saveGameConfig() {
  const id = document.getElementById("editChapterId").value;
  const requiredMinutes = Number(document.getElementById("editRequiredMinutes").value);
  const questionCount = Number(document.getElementById("editQuestionCount").value);

  if (!Number.isInteger(requiredMinutes) || requiredMinutes < 0 || requiredMinutes > 240) {
    alert("เวลาต้องเป็นจำนวนเต็ม 0-240 นาที");
    return;
  }
  if (!Number.isInteger(questionCount) || questionCount < 1 || questionCount > 50) {
    alert("จำนวนคำถามต้องเป็น 1-50 ข้อ");
    return;
  }

  const btn = document.querySelector("#gameEditModal .edit-confirm-btn");
  btn.disabled = true;

  try {
    const { chapter: updated } = await adminApiFetch(`/admin/game-config/${id}`, {
      method: "PUT",
      body: JSON.stringify({ requiredMinutes, questionCount }),
    });
    const chapter = currentChapters.find((c) => c.id === Number(id));
    if (chapter) Object.assign(chapter, updated);
    closeEditModal();
    renderGameCards();
  } catch (err) {
    alert("บันทึกไม่สำเร็จ: " + err.message);
  } finally {
    btn.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (!getAdminToken()) return;
  loadGameConfig();

  // ปิด modal เมื่อคลิกพื้นหลัง
  document.getElementById("gameEditModal").addEventListener("click", function (e) {
    if (e.target === this) closeEditModal();
  });
});
