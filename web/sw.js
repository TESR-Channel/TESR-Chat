// TESR Chat — Service Worker
// ทำให้ติดตั้งเป็นแอปได้ เปิดเร็วขึ้น และรับแจ้งเตือนข้อความใหม่ (Web Push) แม้ปิดแอปอยู่
const CACHE = "tesr-chat-v2";
const SHELL = ["./", "./index.html", "./config.js", "./icon.svg", "./manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// ไฟล์ของเว็บเอง: ดึงจากเน็ตก่อน (ได้เวอร์ชันล่าสุดเสมอ) ถ้าออฟไลน์ใช้ของใน cache
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("./index.html"))),
  );
});

// มีข้อความใหม่จากลูกค้า (ส่งมาจาก Supabase)
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data?.text() }; }
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    // ถ้ากำลังเปิดแอปอยู่หน้าจอ แอปจะเล่นเสียง/โชว์เองแล้ว ไม่ต้องเด้งซ้ำ
    if (wins.some((w) => w.visibilityState === "visible" && w.focused)) return;
    await self.registration.showNotification(d.title || "TESR Chat", {
      body: d.body || "มีข้อความใหม่",
      tag: d.tag || "tesr-chat",
      renotify: true,
      icon: "icon.svg",
      badge: "icon.svg",
      vibrate: [120, 60, 120],
      data: { contactId: d.contactId },
    });
  })());
});

// กดที่แจ้งเตือน → เปิดแอปไปที่แชตนั้น
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const id = e.notification.data?.contactId;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const w = wins.find((c) => c.url.startsWith(self.registration.scope));
    if (w) {
      await w.focus();
      if (id) w.postMessage({ type: "open-chat", contactId: id });
      return;
    }
    await self.clients.openWindow(id ? `./?c=${id}` : "./");
  })());
});
