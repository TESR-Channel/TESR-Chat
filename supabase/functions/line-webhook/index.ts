// TESR Chat — LINE OA webhook
// Webhook URL: https://<project-ref>.supabase.co/functions/v1/line-webhook
// ค่าเชื่อมต่อตั้งจากหน้าเว็บ > ตั้งค่า > LINE OA
import { db, getChannel, storeFromUrl, hmacSha256, safeEqual } from "../_shared/config.ts";
import { notifyStaff } from "../_shared/push.ts";

const profileCache = new Map<string, { name?: string; pic?: string }>();

async function getProfile(userId: string, token: string) {
  if (profileCache.has(userId)) return profileCache.get(userId)!;
  try {
    const r = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (r.ok) {
      const p = await r.json();
      const v = { name: p.displayName, pic: p.pictureUrl };
      profileCache.set(userId, v);
      return v;
    }
  } catch (_) { /* ignore */ }
  return {};
}

async function handleEvent(ev: any, token: string) {
  if (ev.type !== "message") return;
  const userId: string | undefined = ev.source?.userId;
  if (!userId) return;

  const m = ev.message;
  const content = (name?: string) => storeFromUrl(
    `https://api-data.line.me/v2/bot/message/${m.id}/content`, "line",
    { Authorization: `Bearer ${token}` }, name,
  );
  let type = m.type as string;
  let text: string | null = null;
  let media: string | null = null;
  let fileName: string | null = null;

  switch (m.type) {
    case "text":
      text = m.text; break;
    case "image": case "video": case "audio":
      media = m.contentProvider?.type === "external" ? m.contentProvider.originalContentUrl : await content();
      break;
    case "file":
      fileName = m.fileName ?? null; text = fileName;
      media = await content(m.fileName);
      break;
    case "sticker":
      media = `https://stickershop.line-scdn.net/stickershop/v1/sticker/${m.stickerId}/android/sticker.png`;
      break;
    case "location":
      text = `${m.title ?? ""} ${m.address ?? ""}`.trim();
      media = `https://maps.google.com/?q=${m.latitude},${m.longitude}`;
      break;
    default:
      type = "other"; text = `[${m.type}]`;
  }

  const prof = await getProfile(userId, token);
  const { data: contactId, error } = await db.rpc("ingest_message", {
    p_channel: "line", p_uid: userId, p_name: prof.name ?? null, p_avatar: prof.pic ?? null,
    p_type: type, p_text: text, p_media: media, p_file_name: fileName,
    p_mid: m.id, p_raw: ev, p_reply_token: ev.replyToken ?? null,
  });
  if (error) console.error("ingest", error);
  else if (contactId) await notifyStaff({ contactId, channel: "line", name: prof.name, text, type });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("TESR Chat LINE webhook OK");
  const cfg = await getChannel("line");
  const secret = cfg.secrets.channel_secret, token = cfg.secrets.channel_access_token;
  if (!secret || !token) return new Response("LINE not configured", { status: 503 });

  const body = await req.text();
  const sig = req.headers.get("x-line-signature") ?? "";
  const expected = btoa(String.fromCharCode(...await hmacSha256(secret, body)));
  if (!safeEqual(expected, sig)) return new Response("bad signature", { status: 401 });

  const { events = [] } = JSON.parse(body);
  if (!cfg.enabled) return new Response("ok (disabled)"); // ปิดช่องทางไว้: ตอบ 200 แต่ไม่บันทึก
  await Promise.allSettled(events.map((e: any) => handleEvent(e, token)));
  return new Response("ok");
});
