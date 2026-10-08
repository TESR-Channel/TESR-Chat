// TESR Chat — API สำหรับหน้า "ตั้งค่า" (แอดมินเท่านั้น)
// - ทดสอบการเชื่อมต่อแต่ละช่องทาง
// - ตั้ง Webhook LINE อัตโนมัติ / ผูกเพจ Facebook กับแอป
// - เพิ่มพนักงาน / รีเซ็ตรหัสผ่าน
import { db, getChannel, cors, json, requireStaff, GRAPH } from "../_shared/config.ts";

const FN_BASE = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;

type Result = { ok: boolean; msg: string; data?: unknown };

async function saveTest(channel: string, r: Result) {
  await db.from("channel_configs").update({
    last_test_at: new Date().toISOString(), last_test_ok: r.ok, last_test_msg: r.msg.slice(0, 500),
  }).eq("channel", channel);
  return r;
}

async function testChannel(channel: string): Promise<Result> {
  const c = await getChannel(channel, true);
  switch (channel) {
    case "line": {
      const t = c.secrets.channel_access_token;
      if (!t || !c.secrets.channel_secret) return { ok: false, msg: "ยังใส่ Channel secret / Access token ไม่ครบ" };
      const r = await fetch("https://api.line.me/v2/bot/info", { headers: { Authorization: `Bearer ${t}` } });
      if (!r.ok) return { ok: false, msg: `Access token ไม่ถูกต้อง (${r.status})` };
      const info = await r.json();
      const w = await fetch("https://api.line.me/v2/bot/channel/webhook/endpoint", {
        headers: { Authorization: `Bearer ${t}` },
      }).then((x) => x.ok ? x.json() : null).catch(() => null);
      const expected = `${FN_BASE}/line-webhook`;
      const hook = !w ? "เช็ก webhook ไม่ได้"
        : w.endpoint !== expected ? "⚠️ Webhook URL ยังไม่ตรง (กดปุ่ม 'ตั้ง Webhook อัตโนมัติ')"
        : !w.active ? "⚠️ ยังไม่ได้เปิด Use webhook" : "Webhook ✓";
      return { ok: true, msg: `เชื่อมต่อ ${info.displayName} (${info.basicId}) สำเร็จ · ${hook}`, data: info };
    }
    case "facebook": {
      const t = c.secrets.page_access_token, page = c.config.page_id;
      if (!t) return { ok: false, msg: "ยังไม่ได้ใส่ Page access token" };
      if (!c.secrets.app_secret) return { ok: false, msg: "ยังไม่ได้ใส่ App secret" };
      if (!c.config.verify_token) return { ok: false, msg: "ยังไม่ได้ตั้ง Verify token" };
      // ใช้ /me ด้วย Page token (ไม่ต้องขอสิทธิ์ pages_read_engagement เพิ่ม)
      const r = await fetch(`${GRAPH(c)}/me?fields=id,name&access_token=${encodeURIComponent(t)}`);
      const j = await r.json();
      if (!r.ok) return { ok: false, msg: `Page access token ใช้ไม่ได้ (กด Generate ใหม่ใน Messenger API Settings): ${j?.error?.message ?? r.status}` };
      if (page && j.id !== page) {
        return { ok: false, msg: `Page ID ไม่ตรงกับ token — token นี้เป็นของเพจ "${j.name}" (ID ${j.id}) แก้ช่อง Page ID เป็น ${j.id}` };
      }
      const s = await fetch(`${GRAPH(c)}/me/subscribed_apps?access_token=${encodeURIComponent(t)}`)
        .then((x) => x.json()).catch(() => ({}));
      const mine = (s?.data ?? []).find((a: any) => !c.config.app_id || a.id === c.config.app_id) ?? (s?.data ?? [])[0];
      const fields: string[] = mine?.subscribed_fields ?? [];
      const sub = !mine ? "⚠️ เพจยังไม่ได้ผูกกับแอป (กด 'ผูกเพจกับแอป')"
        : !fields.includes("messages") ? "⚠️ ยังไม่ได้รับ field 'messages' (กด 'ผูกเพจกับแอป')"
        : "รับข้อความ Messenger ✓";
      return { ok: true, msg: `เชื่อมต่อเพจ "${j.name}" สำเร็จ · ${sub}` };
    }
    case "instagram": {
      const fb = await getChannel("facebook", true);
      const t = c.secrets.page_access_token || fb.secrets.page_access_token, ig = c.config.ig_user_id;
      if (!ig) return { ok: false, msg: "ยังไม่ได้ใส่ Instagram account ID" };
      if (!t) return { ok: false, msg: "ยังไม่มี Page access token (ตั้งที่ Facebook ก่อน)" };
      const r = await fetch(`${GRAPH(fb)}/${ig}?fields=username,name&access_token=${encodeURIComponent(t)}`);
      const j = await r.json();
      if (!r.ok) return { ok: false, msg: `เชื่อมไม่ได้: ${j?.error?.message ?? r.status}` };
      return { ok: true, msg: `เชื่อมต่อ @${j.username} สำเร็จ` };
    }
    case "youtube": {
      const k = c.secrets.api_key, ch = c.config.channel_id;
      if (!k || !ch) return { ok: false, msg: "ยังใส่ API key / Channel ID ไม่ครบ" };
      const r = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${ch}&key=${k}`);
      const j = await r.json();
      if (!r.ok || !j.items?.length) return { ok: false, msg: `เชื่อมไม่ได้: ${j?.error?.message ?? "ไม่พบช่อง"}` };
      return { ok: true, msg: `พบช่อง "${j.items[0].snippet.title}" · (ตัวดึงคอมเมนต์อยู่ในเฟสถัดไป)` };
    }
    default:
      return { ok: false, msg: "บันทึกค่าไว้แล้ว · ตัวเชื่อมต่อช่องทางนี้อยู่ในเฟสถัดไป จึงยังทดสอบไม่ได้" };
  }
}

async function lineSetWebhook(): Promise<Result> {
  const c = await getChannel("line", true);
  const t = c.secrets.channel_access_token;
  if (!t) return { ok: false, msg: "ใส่ Access token และกดบันทึกก่อน" };
  const endpoint = `${FN_BASE}/line-webhook`;
  const put = await fetch("https://api.line.me/v2/bot/channel/webhook/endpoint", {
    method: "PUT", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
  if (!put.ok) return { ok: false, msg: `ตั้ง Webhook ไม่สำเร็จ: ${await put.text()}` };
  const test = await fetch("https://api.line.me/v2/bot/channel/webhook/test", {
    method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  }).then((x) => x.json()).catch(() => null);
  return test?.success
    ? { ok: true, msg: "ตั้ง Webhook และทดสอบผ่านแล้ว ✓ (อย่าลืมเปิด 'Use webhook' ใน LINE Developers)" }
    : { ok: false, msg: `ตั้ง URL แล้ว แต่ทดสอบไม่ผ่าน: ${test?.reason ?? test?.detail ?? "ไม่ทราบสาเหตุ"} — เช็กว่าบันทึก Channel secret ถูกต้องและเปิดช่องทางแล้ว` };
}

async function fbSubscribePage(): Promise<Result> {
  const c = await getChannel("facebook", true);
  const t = c.secrets.page_access_token;
  if (!t) return { ok: false, msg: "ใส่ Page access token แล้วบันทึกก่อน" };
  const r = await fetch(
    `${GRAPH(c)}/me/subscribed_apps?subscribed_fields=messages,messaging_postbacks&access_token=${encodeURIComponent(t)}`,
    { method: "POST" },
  );
  const j = await r.json();
  return r.ok && j.success
    ? { ok: true, msg: "ผูกเพจกับแอปเรียบร้อย ✓ ข้อความ Messenger จะเข้าระบบแล้ว" }
    : { ok: false, msg: `ไม่สำเร็จ: ${j?.error?.message ?? r.status}` };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const admin = await requireStaff(req, true);
  if (!admin) return json({ ok: false, msg: "เฉพาะแอดมินเท่านั้น" }, 403);

  const b = await req.json().catch(() => ({}));
  try {
    switch (b.action) {
      case "test":
        return json(await saveTest(b.channel, await testChannel(b.channel)));
      case "line_set_webhook":
        return json(await lineSetWebhook());
      case "fb_subscribe_page":
        return json(await fbSubscribePage());

      case "list_users": {
        const { data, error } = await db.auth.admin.listUsers({ perPage: 1000 });
        if (error) throw error;
        return json({ ok: true, data: data.users.map((u) => ({
          id: u.id, email: u.email, last_sign_in_at: u.last_sign_in_at,
        })) });
      }
      case "create_user": {
        const { email, password, name, role } = b;
        if (!email || !password || password.length < 8) {
          return json({ ok: false, msg: "ต้องมีอีเมล และรหัสผ่านอย่างน้อย 8 ตัว" }, 400);
        }
        const { data, error } = await db.auth.admin.createUser({
          email, password, email_confirm: true, user_metadata: { name: name || email.split("@")[0] },
        });
        if (error) return json({ ok: false, msg: error.message }, 400);
        await db.from("staff").update({
          role: role === "admin" ? "admin" : "agent",
          position: b.position || null, phone: b.phone || null,
        }).eq("id", data.user.id);
        // เก็บรหัสเริ่มต้นให้แอดมินดูได้ (ถูกลบเมื่อพนักงานเปลี่ยนรหัสเอง)
        await db.from("staff_initial_pw").upsert({ staff_id: data.user.id, password, set_by: admin.id, set_at: new Date().toISOString() });
        await db.from("activity_log").insert({ actor: admin.id, action: `เพิ่มพนักงาน ${email}` });
        return json({ ok: true, msg: "เพิ่มพนักงานแล้ว" });
      }
      case "reset_password": {
        if (!b.user_id || !b.password || b.password.length < 8) {
          return json({ ok: false, msg: "รหัสผ่านอย่างน้อย 8 ตัว" }, 400);
        }
        const { error } = await db.auth.admin.updateUserById(b.user_id, { password: b.password });
        if (error) return json({ ok: false, msg: error.message }, 400);
        await db.from("staff_initial_pw").upsert({ staff_id: b.user_id, password: b.password, set_by: admin.id, set_at: new Date().toISOString() });
        await db.from("activity_log").insert({ actor: admin.id, action: "รีเซ็ตรหัสผ่านพนักงาน", detail: { user: b.user_id } });
        return json({ ok: true, msg: "เปลี่ยนรหัสผ่านแล้ว" });
      }
      default:
        return json({ ok: false, msg: "unknown action" }, 400);
    }
  } catch (e) {
    return json({ ok: false, msg: String((e as Error).message ?? e) }, 500);
  }
});
