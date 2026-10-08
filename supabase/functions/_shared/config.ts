// ใช้ร่วมกันทุก Edge Function: อ่านค่าการเชื่อมต่อจากตาราง channel_configs
// (ตั้งค่าจากหน้าเว็บ > ตั้งค่า) ถ้ายังไม่ได้ตั้ง จะลองอ่านจาก Environment แทน
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

export const db: SupabaseClient = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

export type ChannelConfig = {
  enabled: boolean;
  config: Record<string, string>;
  secrets: Record<string, string>;
};

const ENV_FALLBACK: Record<string, Record<string, string>> = {
  line: {
    channel_secret: "LINE_CHANNEL_SECRET",
    channel_access_token: "LINE_CHANNEL_ACCESS_TOKEN",
  },
};

const cache = new Map<string, { at: number; v: ChannelConfig }>();

export async function getChannel(channel: string, fresh = false): Promise<ChannelConfig> {
  const hit = cache.get(channel);
  if (!fresh && hit && Date.now() - hit.at < 30_000) return hit.v;

  const { data } = await db.from("channel_configs")
    .select("enabled, config, secrets").eq("channel", channel).maybeSingle();
  const v: ChannelConfig = {
    enabled: data?.enabled ?? false,
    config: (data?.config ?? {}) as Record<string, string>,
    secrets: (data?.secrets ?? {}) as Record<string, string>,
  };
  for (const [k, env] of Object.entries(ENV_FALLBACK[channel] ?? {})) {
    if (!v.secrets[k] && Deno.env.get(env)) {
      v.secrets[k] = Deno.env.get(env)!;
      if (!data) v.enabled = true; // ตั้งผ่าน env อย่างเดียว = ถือว่าเปิด
    }
  }
  cache.set(channel, { at: Date.now(), v });
  return v;
}

export const GRAPH = (cfg: ChannelConfig) =>
  `https://graph.facebook.com/${cfg.config.graph_version || "v23.0"}`;

const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp",
  "video/mp4": "mp4", "audio/m4a": "m4a", "audio/x-m4a": "m4a", "audio/mp4": "m4a",
  "audio/mpeg": "mp3", "application/pdf": "pdf",
};

// ดาวน์โหลดไฟล์จาก URL ของแพลตฟอร์ม แล้วเก็บถาวรใน Storage (URL ของแพลตฟอร์มมักหมดอายุ)
export async function storeFromUrl(
  url: string, folder: string, headers: Record<string, string> = {}, fileName?: string,
): Promise<string | null> {
  try {
    const r = await fetch(url, { headers });
    if (!r.ok) return null;
    const type = (r.headers.get("content-type") ?? "application/octet-stream").split(";")[0];
    const ext = fileName?.includes(".")
      ? fileName.split(".").pop()!.toLowerCase().replace(/[^a-z0-9]/g, "")
      : (EXT[type] ?? "bin");
    const path = `${folder}/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
    const { error } = await db.storage.from("media").upload(path, await r.arrayBuffer(), {
      contentType: type, upsert: false,
    });
    if (error) { console.error("upload", error); return null; }
    return db.storage.from("media").getPublicUrl(path).data.publicUrl;
  } catch (e) {
    console.error("storeFromUrl", e);
    return null;
  }
}

export async function hmacSha256(secret: string, body: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

// ตรวจว่าผู้เรียกเป็นพนักงาน (และเป็นแอดมินถ้าต้องการ)
export async function requireStaff(req: Request, adminOnly = false) {
  const auth = req.headers.get("Authorization") ?? "";
  const jwt = auth.replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data: { user } } = await db.auth.getUser(jwt);
  if (!user) return null;
  const { data: staff } = await db.from("staff").select("id, role, active, display_name")
    .eq("id", user.id).maybeSingle();
  if (!staff?.active) return null;
  if (adminOnly && staff.role !== "admin") return null;
  return staff as { id: string; role: string; active: boolean; display_name: string };
}
