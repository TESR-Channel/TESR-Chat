// แจ้งเตือนพนักงานทุกคนผ่าน Web Push เมื่อมีข้อความใหม่จากลูกค้า
// (ทำงานแม้ปิดแอป/ล็อกจอ — มือถือ Android, iPhone ที่ติดตั้งเป็นแอป, คอม)
import webpush from "npm:web-push@3.6.7";
import { db } from "./config.ts";

const CH_NAME: Record<string, string> = {
  line: "LINE", facebook: "Facebook", instagram: "Instagram", tiktok: "TikTok",
  youtube: "YouTube", shopee: "Shopee", lazada: "Lazada",
};

let ready: Promise<boolean> | null = null;
function init(): Promise<boolean> {
  ready ??= (async () => {
    const { data } = await db.from("app_secrets").select("key, value")
      .in("key", ["vapid_public_key", "vapid_private_key", "vapid_subject"]);
    const k = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
    if (!k.vapid_public_key || !k.vapid_private_key) return false;
    webpush.setVapidDetails(k.vapid_subject || "mailto:admin@example.com", k.vapid_public_key, k.vapid_private_key);
    return true;
  })().catch((e) => { console.error("push init", e); ready = null; return false; });
  return ready;
}

export async function notifyStaff(m: {
  contactId: string; channel: string; name?: string | null; text?: string | null; type?: string;
}) {
  try {
    if (!(await init())) return;
    const { data: subs } = await db.from("push_subscriptions")
      .select("id, endpoint, p256dh, auth, staff!inner(active)")
      .eq("staff.active", true);
    if (!subs?.length) return;

    const media: Record<string, string> = {
      image: "📷 ส่งรูปภาพ", video: "🎬 ส่งวิดีโอ", audio: "🎤 ส่งข้อความเสียง",
      file: "📎 ส่งไฟล์", sticker: "😊 ส่งสติกเกอร์", location: "📍 ส่งตำแหน่ง",
    };
    const body = (m.type && m.type !== "text" ? media[m.type] ?? "ส่งข้อความ" : (m.text ?? "")).slice(0, 140);
    const payload = JSON.stringify({
      title: `${CH_NAME[m.channel] ?? m.channel} · ${m.name ?? "ลูกค้า"}`,
      body,
      tag: `tesr-${m.contactId}`,
      contactId: m.contactId,
    });

    const dead: number[] = [];
    await Promise.allSettled(subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload, { TTL: 3600, urgency: "high" },
        );
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) dead.push(s.id); // เครื่องนั้นเลิกรับแจ้งเตือนแล้ว
        else console.error("push", code, (e as Error).message);
      }
    }));
    if (dead.length) await db.from("push_subscriptions").delete().in("id", dead);
  } catch (e) {
    console.error("notifyStaff", e);
  }
}
