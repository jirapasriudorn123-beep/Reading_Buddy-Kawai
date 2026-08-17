// ================== เมาส์คัสตอมรูปน้องหมา ==================
// ทำงานคล้ายระบบ event-cursor: ซ่อนเคอร์เซอร์เดิม แล้วให้รูปน้องหมาลอยตามเมาส์แทน
// โต, เรืองแสง ตอนชี้ของที่คลิกได้ / เด้งย่อ ตอนคลิก ปิดการทำงานอัตโนมัติบนมือถือ/แท็บเล็ต (หน้าจอสัมผัส)

(function () {
  if (window.matchMedia && window.matchMedia("(hover: none) and (pointer: coarse)").matches) return;

  const cursor = document.createElement("div");
  cursor.className = "custom-cursor";
  document.body.appendChild(cursor);
  document.body.classList.add("custom-cursor-active");

  const HOVER_SELECTOR =
    "a, button, input, textarea, select, label, [onclick], .menu-item, .action-btn, .price-btn, .add-btn, .toggle-btn";

  let clickTimeout = null;

  document.addEventListener("mousemove", (e) => {
    cursor.style.left = e.clientX + "px";
    cursor.style.top = e.clientY + "px";
    cursor.classList.add("visible");
  });

  document.addEventListener("mouseleave", () => cursor.classList.remove("visible"));
  document.addEventListener("mouseenter", () => cursor.classList.add("visible"));

  document.addEventListener("mouseover", (e) => {
    if (e.target.closest(HOVER_SELECTOR)) cursor.classList.add("hover");
  });
  document.addEventListener("mouseout", (e) => {
    if (e.target.closest(HOVER_SELECTOR)) cursor.classList.remove("hover");
  });

  document.addEventListener("mousedown", () => {
    cursor.classList.add("click");
    clearTimeout(clickTimeout);
    clickTimeout = setTimeout(() => cursor.classList.remove("click"), 300);
  });
})();
