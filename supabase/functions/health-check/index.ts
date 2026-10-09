// TESR Chat — ตรวจสุขภาพการเชื่อมต่อทุกช่องทาง (pg_cron เรียกทุก 5 นาที)
// ผลเก็บที่ app_settings.channel_health → หน้าเว็บแสดงแถบเตือนทันทีถ้าช่องทางไหนรับข้อความไม่ได้
import { db, getChannel, GRAPH, json } from "../_shared/config.ts";

const FN_BASE = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;
const enc = encodeURIComponent;
const getJson = (u: string, init?: RequestInit) => fetch(u, init).then((r) => r.json()).catch((e) => ({ error: { message: String(e) } }));

async function secret(key: string) {
  const { data } = await db.from("app_secrets").select("value").eq("key", key).maybeSingle();
  return (data?.value as string | undefined) ?? null;
}

type Problem = { channel: string; msg: string; fix?: string };

async function checkLine(problems: Problem[]) {
  const c = await getChannel("line", true);
  if (!c.enabled) return;
  const t = c.secrets.channel_access_token;
  if (!t) { problems.push({ channel: "line", msg: "ยังไม่ได้ใส่ Access token" }); return; }
  const info = await fetch("https://api.line.me/v2/bot/info", { headers: { Authorization: `Bearer ${t}` } });
  if (info.status === 401) { problems.push({ channel: "line", msg: "Access token ใช้ไม่ได้แล้ว", fix: "ตั้งค่า › LINE › ใส่ Channel access token ใหม่" }); return; }
  const w = await getJson("https://api.line.me/v2/bot/channel/webhook/endpoint", { headers: { Authorization: `Bearer ${t}` } });
  const expected = `${FN_BASE}/line-webhook`;
  if (w?.endpoint && w.endpoint !== expected) problems.push({ channel: "line", msg: "Webhook URL ใน LINE ไม่ตรงกับระบบ", fix: "ตั้งค่า › LINE › กด 'ตั้ง Webhook อัตโนมัติ'" });
  if (w && w.active === false) problems.push({ channel: "line", msg: "LINE ปิด 'Use webhook' อยู่ — ข้อความลูกค้าจะไม่เข้าระบบ", fix: "LINE Developers › Messaging API › เปิด Use webhook" });
  // event ที่รับมาแล้วแต่ประมวลผลไม่สำเร็จหลายรอบ
  const { count } = await db.from("webhook_events").select("id", { count: "exact", head: true })
    .eq("channel", "line").is("processed_at", null).gte("attempts", 3);
  if (count) problems.push({ channel: "line", msg: `มีข้อความ LINE ${count} รายการที่บันทึกไม่สำเร็จ (ระบบกำลังลองซ้ำ)` });
}

async function checkMeta(problems: Problem[]) {
  const fb = await getChannel("facebook", true);
  const ig = await getChannel("instagram", true);
  const app = fb.config.app_id, sec = fb.secrets.app_secret;
  if (!app || !sec) return;
  const G = GRAPH(fb);
  for (const [kind, ch] of [["facebook", fb], ["instagram", ig]] as const) {
    if (!ch.enabled) continue;
    const t = ch.secrets.page_access_token || fb.secrets.page_access_token;
    if (!t) { problems.push({ channel: kind, msg: "ยังไม่ได้ใส่ Page access token" }); continue; }
    const d = (await getJson(`${G}/debug_token?input_token=${enc(t)}&access_token=${enc(`${app}|${sec}`)}`)).data ?? {};
    if (d.is_valid === false) problems.push({ channel: kind, msg: "Page access token หมดอายุ/ถูกยกเลิก — ข้อความจะไม่เข้าระบบ", fix: "Meta › Messenger API Settings › Generate token ใหม่ แล้ววางใน ตั้งค่า" });
    else if (d.expires_at && d.expires_at * 1000 - Date.now() < 3 * 86400_000) problems.push({ channel: kind, msg: "Page access token จะหมดอายุภายใน 3 วัน", fix: "Generate token ใหม่ล่วงหน้า" });
  }
  // ตัวดึงข้อความ (meta-sync) ไม่ได้รันนานเกิน 5 นาที
  const since = await secret("meta_sync_last_ok");
  if (since && Date.now() - Date.parse(since) > 5 * 60_000) problems.push({ channel: "facebook", msg: "ตัวดึงข้อความ Facebook/IG ไม่ได้ทำงานมากกว่า 5 นาที" });
}

Deno.serve(async (req) => {
  const u = new URL(req.url);
  const k = req.headers.get("x-sync-key") ?? u.searchParams.get("k");
  if (!k || k !== (await secret("sync_key"))) return new Response("forbidden", { status: 403 });
  const problems: Problem[] = [];
  await Promise.allSettled([checkLine(problems), checkMeta(problems)]);
  const value = { checked_at: new Date().toISOString(), ok: problems.length === 0, problems };
  await db.from("app_settings").upsert({ key: "channel_health", value, updated_at: new Date().toISOString() });
  return json(value);
});
