// TESR Chat — ส่งข้อความจากหน้า Inbox ไปหาลูกค้า (เรียกจากเว็บ พร้อม JWT ของพนักงาน)
import {
  db, getChannel, cors, json, requireStaff, GRAPH,
} from "../_shared/config.ts";

type Payload = {
  contact_id: string;
  text?: string;
  media_url?: string;
  media_kind?: "image" | "video" | "audio" | "file";
  file_name?: string;
  preview_url?: string; // หน้าปกวิดีโอ (jpg)
  items?: Item[];       // ส่งหลายไฟล์ในคำขอเดียว (LINE รวมเป็น reply ครั้งเดียวได้สูงสุด 5 รายการ)
};
type Item = { media_url?: string; media_kind?: Payload["media_kind"]; file_name?: string; preview_url?: string };
type Sender = (contact: any, p: Payload, items: Item[]) => Promise<Record<string, unknown> | void>;

const fileLink = (p: Item) => `📎 ${p.file_name ?? "ไฟล์แนบ"}\n${p.media_url}`;

// ---------- LINE ----------
// ประหยัดโควตา: ใช้ Reply message (ฟรี ไม่นับโควตาแพ็กเกจ) ก่อนเสมอ ถ้า reply token ใช้ไม่ได้ (หมดอายุ/ถูกใช้แล้ว)
// ค่อยใช้ Push message (นับโควตา) · reply 1 ครั้งส่งได้สูงสุด 5 ข้อความ จึงรวมไฟล์+ข้อความที่ส่งพร้อมกันไว้ในครั้งเดียว
function lineMessages(items: Item[], text?: string) {
  const messages: any[] = [];
  for (const it of items) {
    if (!it.media_url) continue;
    const isLineImage = it.media_kind === "image" && /\.(jpe?g|png)(\?|$)/i.test(it.media_url);
    // วิดีโอ: LINE เล่นได้เฉพาะ .mp4 และต้องมีภาพหน้าปก
    const isLineVideo = it.media_kind === "video" && !!it.preview_url && /\.mp4(\?|$)/i.test(it.media_url);
    messages.push(isLineImage
      ? { type: "image", originalContentUrl: it.media_url, previewImageUrl: it.media_url }
      : isLineVideo
      ? { type: "video", originalContentUrl: it.media_url, previewImageUrl: it.preview_url }
      : { type: "text", text: fileLink(it) }); // ไฟล์อื่น/วิดีโอ .mov .webm → ส่งเป็นลิงก์
  }
  if (text?.trim()) messages.push({ type: "text", text: text.slice(0, 5000) });
  return messages;
}

async function lineCall(token: string, kind: "reply" | "push", body: unknown) {
  return await fetch(`https://api.line.me/v2/bot/message/${kind}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`, "Content-Type": "application/json",
      ...(kind === "push" ? { "X-Line-Retry-Key": crypto.randomUUID() } : {}), // retry key ใช้ได้กับ push เท่านั้น
    },
    body: JSON.stringify(body),
  });
}

const sendLine: Sender = async (contact, p, items) => {
  const cfg = await getChannel("line");
  const token = cfg.secrets.channel_access_token;
  if (!token) throw new Error("ยังไม่ได้ตั้งค่า LINE (ตั้งค่า > LINE OA)");
  const messages = lineMessages(items, p.text);
  if (!messages.length) throw new Error("ไม่มีข้อความ");

  const chunks: any[][] = [];
  for (let i = 0; i < messages.length; i += 5) chunks.push(messages.slice(i, i + 5));

  let replied = 0, pushed = 0;
  for (const [i, chunk] of chunks.entries()) {
    // 1) Reply ก่อน: "จอง" reply token แบบ atomic (กันส่ง 2 คำขอพร้อมกันแล้วใช้ token ซ้ำ) — token ใช้ได้ครั้งเดียว
    if (i === 0 && contact.line_reply_token) {
      const { data: claimed } = await db.from("contacts").update({ line_reply_token: null })
        .eq("id", contact.id).eq("line_reply_token", contact.line_reply_token).select("id");
      if (claimed?.length) {
        const r = await lineCall(token, "reply", { replyToken: contact.line_reply_token, messages: chunk });
        if (r.ok) { replied += chunk.length; continue; }
        console.log("LINE reply ไม่สำเร็จ → ใช้ push แทน", r.status, await r.text().catch(() => ""));
      }
    }
    // 2) Push (นับโควตาแพ็กเกจ LINE OA)
    const r = await lineCall(token, "push", { to: contact.platform_user_id, messages: chunk });
    if (!r.ok) {
      const t = await r.text();
      if (r.status === 429) throw new Error("โควตาข้อความ LINE OA เดือนนี้หมดแล้ว (Push) — ตอบได้ฟรีเมื่อลูกค้าทักมาใหม่ (Reply)");
      throw new Error(`LINE ${r.status}: ${t}`);
    }
    pushed += chunk.length;
  }
  return { line_mode: pushed ? (replied ? "reply+push" : "push") : "reply" };
};

// ---------- Facebook Messenger / Instagram DM (Send API เดียวกัน) ----------
function metaSender(kind: "facebook" | "instagram"): Sender {
  return async (contact, p, items) => {
    const fb = await getChannel("facebook");
    const ch = kind === "facebook" ? fb : await getChannel("instagram");
    const token = ch.secrets.page_access_token || fb.secrets.page_access_token;
    if (!token) throw new Error(`ยังไม่ได้ตั้งค่า ${kind === "facebook" ? "Facebook" : "Instagram"}`);

    const send = async (message: unknown) => {
      const r = await fetch(`${GRAPH(fb)}/me/messages?access_token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient: { id: contact.platform_user_id }, messaging_type: "RESPONSE", message }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        const msg = e?.error?.message ?? r.statusText;
        // 10 / 2018278 = เกิน 24 ชม. หลังลูกค้าทักล่าสุด
        if (e?.error?.code === 10 || e?.error?.error_subcode === 2018278) {
          throw new Error("เกิน 24 ชม. หลังลูกค้าทักครั้งล่าสุด Meta ไม่อนุญาตให้ส่ง");
        }
        throw new Error(`Meta ${r.status}: ${msg}`);
      }
    };

    for (const it of items) {
      if (!it.media_url) continue;
      const kindOk = kind === "facebook"
        ? ["image", "video", "audio", "file"] : ["image", "video", "audio"];
      const t = it.media_kind ?? "file";
      if (kindOk.includes(t)) await send({ attachment: { type: t, payload: { url: it.media_url, is_reusable: false } } });
      else await send({ text: fileLink(it).slice(0, 1000) });
    }
    if (p.text?.trim()) {
      const text = p.text.trim();
      for (let i = 0; i < text.length; i += 1900) await send({ text: text.slice(i, i + 1900) });
    }
  };
}

// ---------- ช่องทางอื่น: ใส่ตรงนี้ในเฟสถัดไป ----------
const SENDERS: Record<string, Sender> = {
  line: sendLine,
  facebook: metaSender("facebook"),
  instagram: metaSender("instagram"),
  // tiktok, youtube, shopee, lazada
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const p = (await req.json()) as Payload;
  const items: Item[] = (p.items?.length ? p.items : p.media_url ? [p] : [])
    .filter((x) => x.media_url).slice(0, 20)
    .map(({ media_url, media_kind, file_name, preview_url }) => ({ media_url, media_kind, file_name, preview_url }));
  if (!p.contact_id || (!p.text?.trim() && !items.length)) return json({ error: "ข้อมูลไม่ครบ" }, 400);

  // ตรวจสิทธิ์และดึงข้อมูลลูกค้าพร้อมกัน (เร็วขึ้น)
  const [staff, { data: contact }] = await Promise.all([
    requireStaff(req),
    db.from("contacts").select("*").eq("id", p.contact_id).maybeSingle(),
  ]);
  if (!staff) return json({ error: "ไม่มีสิทธิ์ใช้งาน กรุณาเข้าสู่ระบบใหม่" }, 401);
  if (!contact) return json({ error: "ไม่พบลูกค้า" }, 404);

  let status = "ok", error: string | null = null, info: Record<string, unknown> = {};
  try {
    const sender = SENDERS[contact.channel];
    if (!sender) throw new Error(`ช่องทาง ${contact.channel} ยังส่งข้อความจากระบบไม่ได้`);
    info = (await sender(contact, p, items)) ?? {};
  } catch (e) {
    status = "failed"; error = String((e as Error).message ?? e);
  }

  // บันทึกทีละรายการ (ข้อความพิมพ์ติดไปกับไฟล์แรก เหมือนเดิม)
  const rows: Item[] = items.length ? items : [{}];
  const ids: unknown[] = [];
  for (const [i, it] of rows.entries()) {
    const { data: id } = await db.rpc("record_outgoing", {
      p_contact: contact.id, p_staff: staff.id, p_type: it.media_url ? (it.media_kind ?? "file") : "text",
      p_text: i === 0 ? (p.text?.trim() || null) : null, p_media: it.media_url ?? null,
      p_file_name: it.file_name ?? null, p_status: status, p_error: error,
    });
    ids.push(id);
  }
  return status === "ok" ? json({ ok: true, id: ids[0], ids, ...info }) : json({ ok: false, error }, 502);
});
