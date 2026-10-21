// ================== เสียงตอนกดปุ่ม (ทุกหน้าของผู้ใช้ ยกเว้นมินิเกมที่มีเสียงของตัวเอง) ==================
// ฟังการคลิกทั้งหน้าครั้งเดียว แล้วเล่นเสียงเมื่อสิ่งที่กดเป็นปุ่ม/ลิงก์/การ์ดที่กดได้
// ไม่เล่นกับปุ่มใน tutorial (มีเสียงชี้จุดของตัวเองอยู่แล้ว) และปุ่มที่กดไม่ได้

(function () {
  const CLICK_SOUND = new Audio("sound/ui-click.m4a");
  CLICK_SOUND.preload = "auto";
  CLICK_SOUND.volume = 0.4;

  const CLICKABLE =
    'button, a[href], [role="button"], [onclick], input[type="submit"], input[type="button"], ' +
    "input[type='checkbox'], input[type='radio'], select, .chapter-card, .product-card, .menu-item";
  const SKIP = ".tour-tip, #tourHelpBtn";

  document.addEventListener(
    "click",
    (e) => {
      const el = e.target.closest(CLICKABLE);
      if (!el || el.closest(SKIP) || el.disabled || el.getAttribute("aria-disabled") === "true") return;
      try {
        CLICK_SOUND.currentTime = 0;
        CLICK_SOUND.play().catch(() => {});
      } catch (_) {}
    },
    true
  );
})();
