// ================== ตัวแสดง PDF ในหน้าอ่านหนังสือ (PDF.js) ==================
// แทนตัวแสดง PDF ของเบราว์เซอร์ (iframe) ซึ่งบนมือถือมักแสดงไม่ได้ และหน้าเว็บมองไม่เห็นว่าผู้ใช้อยู่หน้าไหน
// - วาด PDF เองทุกเครื่องหน้าตาเดียวกัน ซูม/เปลี่ยนหน้าได้ วาดเฉพาะหน้าที่ใกล้จอ (PDF ยาว 60+ หน้าก็ไม่กินหน่วยความจำ)
// - แจ้งหน้าปัจจุบันให้หน้าอ่าน (script.js) นับเวลาต่อหน้า = หลักฐานเสริมว่าอ่าน + เปิดต่อจากหน้าเดิมครั้งหน้า
// ไลบรารีโหลดจาก CDN (pdfjs-dist 3.11.174 legacy build รองรับเบราว์เซอร์/มือถือรุ่นเก่า) ถ้าโหลดไม่ได้ script.js จะกลับไปใช้ iframe แบบเดิม
// isEvalSupported: false = ปิดช่องโหว่ที่รู้จักของเวอร์ชันนี้ (CVE-2024-4367) ไม่ให้ PDF สั่งรันโค้ดได้

const PDFJS_CDN = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy";
const PDF_ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

let pdfViewer = null;
let pdfEventBus = null;
let pdfLinkService = null;
let pdfDoc = null;
let pdfLoadingTask = null;
let pdfOpenUrl = null;
let pdfPageListener = null;

function pdfReaderAvailable() {
  return typeof pdfjsLib !== "undefined" && typeof pdfjsViewer !== "undefined";
}

function initPdfViewer() {
  if (pdfViewer) return;
  pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}/build/pdf.worker.min.js`;

  pdfEventBus = new pdfjsViewer.EventBus();
  pdfLinkService = new pdfjsViewer.PDFLinkService({ eventBus: pdfEventBus });
  pdfViewer = new pdfjsViewer.PDFViewer({
    container: document.getElementById("readerPdfContainer"),
    viewer: document.getElementById("readerPdfPages"),
    eventBus: pdfEventBus,
    linkService: pdfLinkService,
    // ปิดเครื่องมือเขียน/วาดบน PDF (ไม่ได้ใช้) — เวอร์ชันนี้ถ้าเปิดไว้ ปิดไฟล์แล้วเปิดไฟล์ใหม่จะ error
    annotationEditorMode: pdfjsLib.AnnotationEditorType.DISABLE,
  });
  pdfLinkService.setViewer(pdfViewer);

  pdfEventBus.on("pagechanging", (e) => {
    updatePdfToolbar();
    if (pdfPageListener) pdfPageListener(e.pageNumber);
  });
  pdfEventBus.on("scalechanging", updatePdfToolbar);
  // หมุนจอ/ย่อหน้าต่าง: ถ้าเลือก "พอดีความกว้าง" อยู่ ให้ปรับตามขนาดใหม่
  window.addEventListener("resize", () => {
    if (pdfDoc && ["page-width", "page-fit"].includes(pdfViewer.currentScaleValue)) {
      pdfViewer.currentScaleValue = pdfViewer.currentScaleValue;
    }
  });
  bindPdfToolbar();
}

// เปิด PDF แล้วไปหน้า startPage — คืนจำนวนหน้าทั้งหมด (โยน error ถ้าเปิดไม่ได้ เช่น ไฟล์อยู่คนละโดเมนที่ไม่เปิด CORS)
async function openPdfReader(url, { startPage = 1, onPageChange = null } = {}) {
  initPdfViewer();
  pdfPageListener = onPageChange;

  // เปิดไฟล์เดิมซ้ำ (อ่านรอบต่อไปของบทเดิม) ไม่ต้องโหลดใหม่
  if (pdfDoc && pdfOpenUrl === url) {
    goToPdfPage(startPage);
    return pdfDoc.numPages;
  }

  closePdfReader();
  pdfOpenUrl = url;
  pdfLoadingTask = pdfjsLib.getDocument({ url, isEvalSupported: false });
  const doc = await pdfLoadingTask.promise;
  if (pdfOpenUrl !== url) return doc.numPages; // ระหว่างโหลด ผู้ใช้ปิด/เปิดบทอื่นไปแล้ว
  pdfDoc = doc;

  const ready = new Promise((resolve) => pdfEventBus.on("pagesinit", resolve, { once: true }));
  pdfViewer.setDocument(doc);
  pdfLinkService.setDocument(doc, null);
  await ready;

  pdfViewer.currentScaleValue = "page-width";
  goToPdfPage(startPage);
  updatePdfToolbar();
  return doc.numPages;
}

function closePdfReader() {
  pdfOpenUrl = null;
  pdfPageListener = null;
  if (pdfLoadingTask) {
    pdfLoadingTask.destroy();
    pdfLoadingTask = null;
  }
  if (pdfViewer && pdfDoc) {
    pdfViewer.setDocument(null);
    pdfLinkService.setDocument(null);
  }
  pdfDoc = null;
}

function currentPdfPage() {
  return pdfDoc ? pdfViewer.currentPageNumber : null;
}

function goToPdfPage(page) {
  if (!pdfDoc) return;
  const target = Math.min(pdfDoc.numPages, Math.max(1, Math.round(Number(page) || 1)));
  pdfViewer.currentPageNumber = target;
}

// ---------- แถบเครื่องมือ (เปลี่ยนหน้า + ซูม) ----------

function zoomPdf(direction) {
  if (!pdfDoc) return;
  const scale = pdfViewer.currentScale;
  const next =
    direction > 0
      ? PDF_ZOOM_STEPS.find((s) => s > scale + 0.01) || PDF_ZOOM_STEPS[PDF_ZOOM_STEPS.length - 1]
      : [...PDF_ZOOM_STEPS].reverse().find((s) => s < scale - 0.01) || PDF_ZOOM_STEPS[0];
  pdfViewer.currentScaleValue = String(next);
}

function updatePdfToolbar() {
  if (!pdfDoc) return;
  const pageInput = document.getElementById("pdfPageInput");
  if (document.activeElement !== pageInput) pageInput.value = pdfViewer.currentPageNumber;
  pageInput.max = pdfDoc.numPages;
  document.getElementById("pdfPageCount").textContent = pdfDoc.numPages;
  document.getElementById("pdfPrevBtn").disabled = pdfViewer.currentPageNumber <= 1;
  document.getElementById("pdfNextBtn").disabled = pdfViewer.currentPageNumber >= pdfDoc.numPages;

  // ช่องเลือกขนาด: โหมดพอดีจอ หรือ % ที่ใกล้ที่สุด (ถ้าไม่ตรงกับตัวเลือก โชว์ % ปัจจุบันเป็นตัวเลือกชั่วคราว)
  const select = document.getElementById("pdfZoomSelect");
  const value = String(pdfViewer.currentScaleValue);
  const custom = select.querySelector("option[data-custom]");
  if ([...select.options].some((o) => o.value === value && !o.dataset.custom)) {
    if (custom) custom.hidden = true;
    select.value = value;
  } else {
    custom.hidden = false;
    custom.value = value;
    custom.textContent = `${Math.round(pdfViewer.currentScale * 100)}%`;
    select.value = value;
  }
}

function bindPdfToolbar() {
  document.getElementById("pdfPrevBtn").addEventListener("click", () => goToPdfPage(currentPdfPage() - 1));
  document.getElementById("pdfNextBtn").addEventListener("click", () => goToPdfPage(currentPdfPage() + 1));
  document.getElementById("pdfZoomOutBtn").addEventListener("click", () => zoomPdf(-1));
  document.getElementById("pdfZoomInBtn").addEventListener("click", () => zoomPdf(1));
  document.getElementById("pdfZoomSelect").addEventListener("change", (e) => {
    if (pdfDoc) pdfViewer.currentScaleValue = e.target.value;
  });
  const pageInput = document.getElementById("pdfPageInput");
  pageInput.addEventListener("change", () => goToPdfPage(pageInput.value));
  pageInput.addEventListener("blur", updatePdfToolbar);
}
