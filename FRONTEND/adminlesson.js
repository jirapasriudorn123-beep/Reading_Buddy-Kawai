let currentChapters = [];
let editingChapterId = null;
let selectedFile = null;

async function loadChapters() {
  try {
    const { chapters } = await adminApiFetch("/admin/chapters");
    currentChapters = chapters;
    renderLessonTable();
  } catch (err) {
    console.error("โหลดรายการบทเรียนไม่สำเร็จ:", err);
    alert("โหลดรายการบทเรียนไม่สำเร็จ: " + err.message);
  }
}

function renderLessonTable() {
  const tbody = document.getElementById("lessonTableBody");
  if (!currentChapters.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#999;">ยังไม่มีบทเรียน</td></tr>`;
    return;
  }
  tbody.innerHTML = currentChapters
    .map(
      (ch) => `
    <tr>
      <td>${ch.chapter_number}</td>
      <td>${escapeHtml(ch.title)}</td>
      <td><button class="action-btn edit-btn" onclick="openEditLesson(${ch.id})" title="แก้ไข">
        <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6.2c-1.8-1.3-4.1-2-6.3-2v12.6c2.2 0 4.5.7 6.3 2 1.8-1.3 4.1-2 6.3-2V4.2c-2.2 0-4.5.7-6.3 2z"/></svg>
      </button></td>
      <td><button class="action-btn delete-btn" onclick="deleteLesson(${ch.id})" title="ลบ">
        <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7"/><path d="M6 7l1 12.5A2 2 0 0 0 9 21h6a2 2 0 0 0 2-1.5L18 7"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
      </button></td>
    </tr>`
    )
    .join("");
}

function displayFileName() {
  const fileInput = document.getElementById("lessonFile");
  const display = document.getElementById("fileNameDisplay");
  if (fileInput.files.length > 0) {
    selectedFile = fileInput.files[0];
    display.textContent = "ไฟล์ที่เลือก: " + selectedFile.name;
    display.style.color = "#89B05D";
  }
}

function openEditLesson(id) {
  const chapter = currentChapters.find((c) => c.id === id);
  if (!chapter) return;

  editingChapterId = id;
  selectedFile = null;
  document.getElementById("lessonChapter").value = chapter.chapter_number;
  document.getElementById("lessonTitle").value = chapter.title;
  document.getElementById("lessonDetail").value = chapter.detail || "";
  document.getElementById("fileNameDisplay").textContent =
    chapter.pdf_url || chapter.image_url ? "มีไฟล์อยู่แล้ว (เลือกไฟล์ใหม่ถ้าต้องการแทนที่)" : "เพิ่มรูปภาพ/ไฟล์";
  document.getElementById("fileNameDisplay").style.color = "";
  document.querySelector(".modal-card h3").innerText = "แก้ไขบทเรียน";
  document.getElementById("addLessonModal").style.display = "flex";
}

async function deleteLesson(id) {
  if (!confirm("คุณแน่ใจหรือไม่ที่จะลบบทเรียนนี้? (ประวัติการอ่านบทนี้ของผู้ใช้ทุกคนจะถูกลบไปด้วย)")) return;
  try {
    await adminApiFetch(`/admin/chapters/${id}`, { method: "DELETE" });
    await loadChapters();
  } catch (err) {
    alert("ลบไม่สำเร็จ: " + err.message);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (!getAdminToken()) return; // adminAuth.js จะเด้งไป login ให้แล้ว

  const modal = document.getElementById("addLessonModal");
  const openBtn = document.getElementById("openAddModal");
  const closeBtn = document.getElementById("closeModal");
  const lessonForm = document.getElementById("lessonForm");

  loadChapters();

  openBtn.onclick = () => {
    editingChapterId = null;
    selectedFile = null;
    lessonForm.reset();
    document.getElementById("fileNameDisplay").textContent = "เพิ่มรูปภาพ/ไฟล์";
    document.getElementById("fileNameDisplay").style.color = "";
    document.querySelector(".modal-card h3").innerText = "เพิ่มบทเรียน";
    modal.style.display = "flex";
  };

  closeBtn.onclick = () => (modal.style.display = "none");

  lessonForm.onsubmit = async (e) => {
    e.preventDefault();
    const chapterNumber = document.getElementById("lessonChapter").value.trim();
    const title = document.getElementById("lessonTitle").value.trim();
    const detail = document.getElementById("lessonDetail").value.trim();

    const saveBtn = lessonForm.querySelector(".save-btn");
    saveBtn.disabled = true;

    try {
      const payload = { chapterNumber, title, detail };

      if (selectedFile) {
        const formData = new FormData();
        formData.append("file", selectedFile);
        const uploadResult = await adminApiFetch("/admin/upload?type=lesson", {
          method: "POST",
          body: formData,
        });
        if (uploadResult.kind === "pdf") payload.pdfUrl = uploadResult.url;
        else payload.imageUrl = uploadResult.url;
      }

      if (editingChapterId) {
        await adminApiFetch(`/admin/chapters/${editingChapterId}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        alert("อัปเดตข้อมูลแล้ว!");
      } else {
        await adminApiFetch("/admin/chapters", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        alert("บันทึกบทเรียนใหม่แล้ว!");
      }

      modal.style.display = "none";
      await loadChapters();
    } catch (err) {
      alert("เกิดข้อผิดพลาด: " + err.message);
    } finally {
      saveBtn.disabled = false;
    }
  };
});
