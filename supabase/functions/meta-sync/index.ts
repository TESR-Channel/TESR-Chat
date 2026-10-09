// TESR Chat — ดึงข้อความ Facebook / Instagram จากกล่องข้อความของเพจทุก 20 วินาที (pg_cron เรียก)
// ใช้คู่กับ webhook: ช่วงที่แอป Meta ยังไม่ Publish ระบบจะไม่ส่ง webhook ของลูกค้าทั่วไปมาให้
// ฟังก์ชันนี้จึงอ่านบทสนทนาของเพจโดยตรงแทน (ข้อความซ้ำจะถูกกรองด้วย message id)
import { db, getChannel, storeFromUrl, GRAPH, ChannelConfig, json } from "../_shared/config.ts";
import { notifyStaff } from "../_shared/push.ts";

const enc = encodeURIComponent;
const getJson = (u: string) => fetch(u).then((r) => r.json()).catch((e) => ({ error: { message: String(e) } }));

async function secret(key: string) {
  const { data } = await db.from("app_secrets").select("value").eq("key", key).maybeSingle();
  return (data?.value as string | undefined) ?? null;
}
const setSecret = (key: string, value: string) => db.from("app_secrets").upsert({ key, value });

const picCache = new Map<string, string | null>();
async function profilePic(fb: ChannelConfig, id: string, token: string) {
  if (picCache.has(id)) return picCache.get(id)!;
  const j = await getJson(`${GRAPH(fb)}/${id}?fields=profile_pic&access_token=${enc(token)}`);
  const pic = j?.profile_pic ?? null;
  picCache.set(id, pic);
  return pic;
}

async function syncChannel(kind: "facebook" | "instagram") {
  const fb = await getChannel("facebook", true);
  const ch = kind === "facebook" ? fb : await getChannel("instagram", true);
  if (!ch.enabled) return { kind, skipped: "ปิดอยู่" };
  const token = ch.secrets.page_access_token || fb.secrets.page_access_token;
  if (!token) return { kind, skipped: "ไม่มี token" };
  const selfId = String(kind === "facebook" ? fb.config.page_id ?? "" : ch.config.ig_user_id ?? "");
  let selfName = "";
  if (kind === "instagram" && selfId) selfName = (await getJson(`${GRAPH(fb)}/${selfId}?fields=username&access_token=${enc(token)}`))?.username ?? "";
  const isSelf = (f: any) => String(f?.id) === selfId || (!!selfName && f?.username === selfName);

  const key = `meta_sync_since_${kind}`;
  const since = Date.parse((await secret(key)) ?? "") || Date.now() - 3 * 3600_000; // ครั้งแรก: ย้อนหลัง 3 ชม.
  const G = GRAPH(fb);
  const conv = await getJson(`${G}/me/conversations?fields=id,updated_time${kind === "instagram" ? "&platform=instagram" : ""}&limit=25&access_token=${enc(token)}`);
  if (conv.error) return { kind, error: conv.error.message };

  let newest = since, added = 0;
  for (const c of conv.data ?? []) {
    const up = Date.parse(c.updated_time);
    if (!(up > since)) continue;
    newest = Math.max(newest, up);
    const ms = await getJson(`${G}/${c.id}/messages?fields=id,created_time,from,to,message,sticker,` +
      `attachments{mime_type,name,image_data,video_data,file_url}&limit=25&access_token=${enc(token)}`);
    if (ms.error) continue;
    const list = (ms.data ?? [])
      .filter((m: any) => m.from?.id && Date.parse(m.created_time) > since - 120_000)
      .reverse(); // เก่า → ใหม่
    for (const m of list) {
      const self = isSelf(m.from);
      const uid = String(self ? m.to?.data?.[0]?.id ?? "" : m.from.id);
      if (!uid) continue;
      const { count } = await db.from("messages").select("id", { count: "exact", head: true })
        .eq("channel", kind).eq("platform_message_id", m.id);
      if (count) continue; // มีแล้ว (จาก webhook หรือรอบก่อน)
      const name = m.from.name || (m.from.username ? `@${m.from.username}` : null);
      let type = "text", text: string | null = m.message || null, media: string | null = null, fileName: string | null = null;
      const att = m.attachments?.data?.[0];
      if (m.sticker) { type = "sticker"; media = m.sticker; }
      else if (att) {
        const mime: string = att.mime_type ?? "";
        const url = att.image_data?.url ?? att.video_data?.url ?? att.file_url ?? null;
        type = att.image_data || mime.startsWith("image/") ? "image"
          : att.video_data || mime.startsWith("video/") ? "video"
          : mime.startsWith("audio/") ? "audio" : "file";
        if (url) media = (await storeFromUrl(url, kind, {}, att.name)) ?? url;
        if (type === "file") { fileName = att.name ?? "ไฟล์แนบ"; text = text ?? fileName; }
      }
      if (!text && !media) text = "[ข้อความที่ระบบยังไม่รองรับ]";
      if (self) { // เพจตอบจากที่อื่น (Business Suite ฯลฯ) → บันทึกเป็นข้อความขาออก
        const { error } = await db.rpc("ingest_page_reply", {
          p_channel: kind, p_uid: uid, p_type: type, p_text: text, p_media: media, p_file_name: fileName,
          p_mid: m.id, p_raw: { via: "sync", ...m }, p_at: m.created_time,
        });
        if (error) console.error("page reply", error);
        continue;
      }
      const avatar = kind === "facebook" ? await profilePic(fb, uid, token) : null;
      const { data: contactId, error } = await db.rpc("ingest_message_at", {
        p_channel: kind, p_uid: uid, p_name: name, p_avatar: avatar,
        p_type: type, p_text: text, p_media: media, p_file_name: fileName,
        p_mid: m.id, p_raw: { via: "sync", ...m }, p_at: m.created_time,
      });
      if (error) { console.error("ingest", error); continue; }
      if (contactId) {
        added++;
        // แจ้งเตือนเฉพาะข้อความที่เพิ่งเข้ามา (ไม่เกิน 10 นาที) กันเด้งรัวตอนดึงย้อนหลัง
        if (Date.now() - Date.parse(m.created_time) < 600_000) {
          await notifyStaff({ contactId, channel: kind, name, text, type });
        }
      }
    }
  }
  await setSecret(key, new Date(newest).toISOString());
  return { kind, added };
}

Deno.serve(async (req) => {
  const k = req.headers.get("x-sync-key") ?? new URL(req.url).searchParams.get("k");
  if (!k || k !== (await secret("sync_key"))) return new Response("forbidden", { status: 403 });
  // กันรันซ้อน (cron เรียกทุก 20 วินาที ถ้ารอบก่อนยังไม่จบให้ข้ามรอบนี้) — ล็อกหมดอายุเองใน 50 วินาที
  const now = Date.now();
  const { data: got } = await db.from("app_secrets").update({ value: new Date(now).toISOString() })
    .eq("key", "meta_sync_lock").lt("value", new Date(now - 50_000).toISOString()).select("key");
  if (!got?.length) return json({ ok: true, skipped: "รอบก่อนยังทำงานอยู่" });
  const out = [];
  try {
    for (const kind of ["facebook", "instagram"] as const) {
      try { out.push(await syncChannel(kind)); } catch (e) { out.push({ kind, error: String(e) }); }
    }
  } finally {
    await db.from("app_secrets").update({ value: "1970-01-01T00:00:00.000Z" }).eq("key", "meta_sync_lock");
  }
  return json({ ok: true, out });
});
