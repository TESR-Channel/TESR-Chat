// TESR Chat — Service Worker
// ทำให้ติดตั้งเป็นแอปได้ และเปิดหน้าเว็บได้เร็วขึ้น (ข้อมูลแชตยังดึงสดจาก Supabase เสมอ)
const CACHE = "tesr-chat-v1";
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
// คำขออื่น (Supabase, CDN, รูปลูกค้า) ปล่อยผ่านตามปกติ ไม่เก็บ cache
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
