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
};
type Sender = (contact: any, p: Payload) => Promise<void>;

const fileLink = (p: Payload) => `📎 ${p.file_name ?? "ไฟล์แนบ"}\n${p.media_url}`;

// ---------- LINE ----------
const sendLine: Sender = async (contact, p) => {
  const cfg = await getChannel("line");
  const token = cfg.secrets.channel_access_token;
  if (!token) throw new Error("ยังไม่ได้ตั้งค่า LINE (ตั้งค่า > LINE OA)");

  const messages: any[] = [];
  if (p.media_url) {
    const isLineImage = p.media_kind === "image" && /\.(jpe?g|png)(\?|$)/i.test(p.media_url);
    messages.push(isLineImage
      ? { type: "image", originalContentUrl: p.media_url, previewImageUrl: p.media_url }
      : { type: "text", text: fileLink(p) }); // LINE API ส่งไฟล์ตรง ๆ ไม่ได้ → ส่งลิงก์
  }
  if (p.text?.trim()) messages.push({ type: "text", text: p.text.slice(0, 5000) });
  if (!messages.length) throw new Error("ไม่มีข้อความ");

  // reply token ยังสด (< 50 วิ) = ไม่กินโควตา, ไม่งั้นใช้ push (นับโควตาแพ็กเกจ LINE OA)
  const age = contact.line_reply_token_at
    ? (Date.now() - new Date(contact.line_reply_token_at).getTime()) / 1000 : Infinity;
  const useReply = !!contact.line_reply_token && age < 50;
  if (useReply) await db.from("contacts").update({ line_reply_token: null }).eq("id", contact.id);

  const r = await fetch(`https://api.line.me/v2/bot/message/${useReply ? "reply" : "push"}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`, "Content-Type": "application/json",
      "X-Line-Retry-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(useReply
      ? { replyToken: contact.line_reply_token, messages }
      : { to: contact.platform_user_id, messages }),
  });
  if (!r.ok) {
    if (useReply) return sendLine({ ...contact, line_reply_token: null }, p);
    throw new Error(`LINE ${r.status}: ${await r.text()}`);
  }
};

// ---------- Facebook Messenger / Instagram DM (Send API เดียวกัน) ----------
function metaSender(kind: "facebook" | "instagram"): Sender {
  return async (contact, p) => {
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

    if (p.media_url) {
      const kindOk = kind === "facebook"
        ? ["image", "video", "audio", "file"] : ["image", "video", "audio"];
      const t = p.media_kind ?? "file";
      if (kindOk.includes(t)) await send({ attachment: { type: t, payload: { url: p.media_url, is_reusable: false } } });
      else await send({ text: fileLink(p).slice(0, 1000) });
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

  const staff = await requireStaff(req);
  if (!staff) return json({ error: "ไม่มีสิทธิ์ใช้งาน กรุณาเข้าสู่ระบบใหม่" }, 401);

  const p = (await req.json()) as Payload;
  if (!p.contact_id || (!p.text?.trim() && !p.media_url)) return json({ error: "ข้อมูลไม่ครบ" }, 400);

  const { data: contact } = await db.from("contacts").select("*").eq("id", p.contact_id).single();
  if (!contact) return json({ error: "ไม่พบลูกค้า" }, 404);

  const msgType = p.media_url ? (p.media_kind ?? "file") : "text";
  let status = "ok", error: string | null = null;
  try {
    const sender = SENDERS[contact.channel];
    if (!sender) throw new Error(`ช่องทาง ${contact.channel} ยังส่งข้อความจากระบบไม่ได้`);
    await sender(contact, p);
  } catch (e) {
    status = "failed"; error = String((e as Error).message ?? e);
  }

  const { data: id } = await db.rpc("record_outgoing", {
    p_contact: contact.id, p_staff: staff.id, p_type: msgType,
    p_text: p.text?.trim() || null, p_media: p.media_url ?? null,
    p_file_name: p.file_name ?? null, p_status: status, p_error: error,
  });
  return status === "ok" ? json({ ok: true, id }) : json({ ok: false, error }, 502);
});
