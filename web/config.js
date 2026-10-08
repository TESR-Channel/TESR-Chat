// ใส่ค่าจาก Supabase Dashboard > Project Settings > API
// (anon key เปิดเผยได้ ปลอดภัยเพราะมี RLS ป้องกัน — ห้ามใส่ service_role key ที่นี่เด็ดขาด)
window.TESR_CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT-REF.supabase.co",
  SUPABASE_ANON_KEY: "YOUR-ANON-KEY",
  SLOW_REPLY_MIN: 10, // ตอบช้ากว่ากี่นาทีถึงขึ้นสีแดง
};
