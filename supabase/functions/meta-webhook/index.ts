// TESR Chat — Facebook Messenger + Instagram DM webhook (Meta App เดียวกัน)
// Callback URL: https://<project-ref>.supabase.co/functions/v1/meta-webhook
// ค่าเชื่อมต่อตั้งจากหน้าเว็บ > ตั้งค่า > Facebook / Instagram
import {
  db, getChannel, storeFromUrl, hmacSha256, safeEqual, GRAPH, ChannelConfig,
} from "../_shared/config.ts";
import { notifyStaff } from "../_shared/push.ts";

const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const profileCache = new Map<string, { name?: string; pic?: string }>();

async function getProfile(kind: "facebook" | "instagram", id: string, fb: ChannelConfig, token: string) {
  const key = `${kind}:${id}`;
  if (profileCache.has(key)) return profileCache.get(key)!;
  const fields = kind === "facebook" ? "first_name,last_name,profile_pic" : "name,username,profile_pic";
  try {
    const r = await fetch(`${GRAPH(fb)}/${id}?fields=${fields}&access_token=${encodeURIComponent(token)}`);
    if (r.ok) {
      const p = await r.json();
      const name = kind === "facebook"
        ? [p.first_name, p.last_name].filter(Boolean).join(" ")
        : (p.name || (p.username ? `@${p.username}` : undefined));
      const v = { name: name || undefined, pic: p.profile_pic };
      profileCache.set(key, v);
      return v;
    }
  } catch (_) { /* ignore */ }
  return {};
}

async function handleMessaging(kind: "facebook" | "instagram", ev: any, fb: ChannelConfig, token: string) {
  const msg = ev.message;
  if (!msg || msg.is_echo || msg.is_deleted) return; // echo = ข้อความที่เพจส่งออกเอง
  const uid: string = ev.sender?.id;
  if (!uid) return;

  let type = "text", text: string | null = msg.text ?? null, media: string | null = null;
  let fileName: string | null = null;
  const att = msg.attachments?.[0];
  if (att) {
    const map: Record<string, string> = { image: "image", video: "video", audio: "audio", file: "file" };
    type = map[att.type] ?? "other";
    if (att.payload?.sticker_id) type = "sticker";
    if (att.payload?.url) {
      media = await storeFromUrl(att.payload.url, kind) ?? att.payload.url;
      if (type === "file") { fileName = att.payload.title ?? "ไฟล์แนบ"; text = text ?? fileName; }
    } else if (att.type === "location" && att.payload?.coordinates) {
      type = "location";
      media = `https://maps.google.com/?q=${att.payload.coordinates.lat},${att.payload.coordinates.long}`;
    } else if (att.type === "share" || att.type === "story_mention" || att.type === "ig_reel") {
      type = "text"; text = `[${att.type}] ${att.payload?.url ?? ""}`.trim();
    }
  }
  if (!text && !media) text = "[ข้อความที่ระบบยังไม่รองรับ]";

  const prof = await getProfile(kind, uid, fb, token);
  const { data: contactId, error } = await db.rpc("ingest_message", {
    p_channel: kind, p_uid: uid, p_name: prof.name ?? null, p_avatar: prof.pic ?? null,
    p_type: type, p_text: text, p_media: media, p_file_name: fileName,
    p_mid: msg.mid ?? null, p_raw: ev, p_reply_token: null,
  });
  if (error) console.error("ingest", error);
  else if (contactId) await notifyStaff({ contactId, channel: kind, name: prof.name, text, type });
}

Deno.serve(async (req) => {
  const fb = await getChannel("facebook");

  // ขั้นตอนยืนยัน webhook ตอนกด "Verify and save" ใน Meta App
  if (req.method === "GET") {
    const u = new URL(req.url);
    if (u.searchParams.get("hub.mode") === "subscribe" &&
        fb.config.verify_token && u.searchParams.get("hub.verify_token") === fb.config.verify_token) {
      return new Response(u.searchParams.get("hub.challenge") ?? "");
    }
    return new Response("TESR Chat Meta webhook — verify token ไม่ตรง", { status: 403 });
  }
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const appSecret = fb.secrets.app_secret;
  if (!appSecret) return new Response("Meta not configured", { status: 503 });
  const body = await req.text();
  const sig = (req.headers.get("x-hub-signature-256") ?? "").replace(/^sha256=/, "");
  if (!safeEqual(toHex(await hmacSha256(appSecret, body)), sig)) {
    return new Response("bad signature", { status: 401 });
  }

  const payload = JSON.parse(body);
  const kind: "facebook" | "instagram" = payload.object === "instagram" ? "instagram" : "facebook";
  const ch = kind === "facebook" ? fb : await getChannel("instagram");
  if (!ch.enabled) return new Response("ok (disabled)");
  const token = ch.secrets.page_access_token || fb.secrets.page_access_token;
  if (!token) return new Response("ok (no token)");

  const jobs: Promise<void>[] = [];
  for (const entry of payload.entry ?? []) {
    for (const ev of entry.messaging ?? []) jobs.push(handleMessaging(kind, ev, fb, token));
  }
  await Promise.allSettled(jobs);
  return new Response("EVENT_RECEIVED");
});
