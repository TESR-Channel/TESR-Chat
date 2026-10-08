// ค่าจาก Supabase Dashboard > Project Settings > API (โปรเจกต์ TESR Chat)
// (anon key เปิดเผยได้ ปลอดภัยเพราะมี RLS ป้องกัน — ห้ามใส่ service_role key ที่นี่เด็ดขาด)
window.TESR_CONFIG = {
  SUPABASE_URL: "https://cfhpkmzevxyyxckwvrpk.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNmaHBrbXpldnh5eXhja3d2cnBrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0MzAwMzYsImV4cCI6MjEwNzAwNjAzNn0.tZjXH78klfFEeCAtefWcBwG3CfiFuDYo2BFYJb9Uh_Q",
  SLOW_REPLY_MIN: 10, // ตอบช้ากว่ากี่นาทีถึงขึ้นสีแดง
};
