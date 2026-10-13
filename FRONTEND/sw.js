// Service Worker ของหน้าอ่านหนังสือ — ใช้แค่แสดงแจ้งเตือน "พักครบแล้ว" (Chrome บน Android ต้องแจ้งเตือนผ่านตัวนี้)
// และกดที่แจ้งเตือนแล้วพากลับมาที่หน้าเว็บ | ไม่ได้แคชไฟล์ใดๆ (ไม่มี fetch handler) หน้าเว็บจึงโหลดของใหม่เสมอ

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const readingPage = windows.find((c) => /index\.html|\/$/.test(new URL(c.url).pathname)) || windows[0];
      if (readingPage) return readingPage.focus();
      return self.clients.openWindow("index.html");
    })()
  );
});
