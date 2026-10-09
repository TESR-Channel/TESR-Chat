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
      const t = c.secrets.page_access_token, page = c.config.page_id, app = c.config.app_id;
      if (!t) return { ok: false, msg: "ยังไม่ได้ใส่ Page access token" };
      if (!app || !c.secrets.app_secret) return { ok: false, msg: "ยังไม่ได้ใส่ App ID / App secret" };
      if (!c.config.verify_token) return { ok: false, msg: "ยังไม่ได้ตั้ง Verify token" };
      // ตรวจ token ด้วย debug_token (ใช้ App token = App ID|App secret ไม่ต้องขอสิทธิ์อ่านเพจเพิ่ม)
      const r = await fetch(`${GRAPH(c)}/debug_token?input_token=${encodeURIComponent(t)}` +
        `&access_token=${encodeURIComponent(`${app}|${c.secrets.app_secret}`)}`);
      const j = await r.json();
      if (!r.ok) return { ok: false, msg: `App ID / App secret ไม่ถูกต้อง: ${j?.error?.message ?? r.status}` };
      const d = j.data ?? {};
      if (!d.is_valid) return { ok: false, msg: `Page access token ใช้ไม่ได้ (กด Generate ใหม่): ${d.error?.message ?? "หมดอายุหรือถูกยกเลิก"}` };
      if (String(d.app_id) !== String(app)) return { ok: false, msg: `token นี้สร้างจากแอปอื่น (App ID ${d.app_id}) ไม่ใช่แอป ${app}` };
      if (d.type !== "PAGE") return { ok: false, msg: `นี่เป็น ${d.type} token — ต้องใช้ Page token (กด Generate ที่แถวเพจใน Messenger API Settings)` };
      if (page && String(d.profile_id) !== String(page)) {
        return { ok: false, msg: `Page ID ไม่ตรงกับ token — token นี้เป็นของเพจ ID ${d.profile_id} แก้ช่อง Page ID เป็นค่านี้` };
      }
      const scopes: string[] = d.scopes ?? [];
      if (!scopes.includes("pages_messaging")) return { ok: false, msg: "token ไม่มีสิทธิ์ pages_messaging — Generate ใหม่และกดอนุญาตทุกข้อ" };
      // เพจต้องส่ง field "messages" ให้แอป ไม่งั้น Meta จะไม่ส่งข้อความมาเลย (เจอจริง: ผูกไว้แค่ field "name")
      // ถ้ายังไม่ได้ผูก ระบบผูกให้อัตโนมัติ
      const subOk = async () => {
        const s = await fetch(`${GRAPH(c)}/me/subscribed_apps?access_token=${encodeURIComponent(t)}`)
          .then((x) => x.json()).catch(() => ({}));
        if (s?.error) return null;
        const mine = (s?.data ?? []).find((a: any) => String(a.id) === String(app));
        return !!mine && (mine.subscribed_fields ?? []).includes("messages");
      };
      let ok = await subOk(), fixed = false;
      if (ok === false) { fixed = (await fbSubscribePage()).ok; ok = fixed ? await subOk() : false; }
      if (ok === false) {
        return { ok: false, msg: `Page token ถูกต้อง แต่เพจยังไม่ส่งข้อความให้แอป และผูกอัตโนมัติไม่สำเร็จ — ไปที่ Messenger API Settings › แถวเพจ › Webhook Subscription ติ๊ก messages` };
      }
      const sub = ok === null ? "(เช็กการผูกเพจไม่ได้ ดูที่ Messenger API Settings แทน)"
        : fixed ? "ผูกเพจให้รับข้อความอัตโนมัติแล้ว ✓" : "รับข้อความ Messenger ✓";
      return { ok: true, msg: `Page token ถูกต้อง (เพจ ID ${d.profile_id}) · ${sub}` };
    }
    case "instagram": {
      const fb = await getChannel("facebook", true);
      const t = c.secrets.page_access_token || fb.secrets.page_access_token;
      const app = fb.config.app_id, sec = fb.secrets.app_secret;
      let ig = c.config.ig_user_id;
      if (!t) return { ok: false, msg: "ยังไม่มี Page access token (ตั้งที่ Facebook ก่อน หรือใส่ token จากหน้า Instagram settings)" };
      // 1) token มีสิทธิ์ Instagram ครบไหม (ตรวจด้วย App token ไม่ต้องขอสิทธิ์เพิ่ม)
      if (app && sec) {
        const d = await fetch(`${GRAPH(fb)}/debug_token?input_token=${encodeURIComponent(t)}` +
          `&access_token=${encodeURIComponent(`${app}|${sec}`)}`).then((x) => x.json()).then((j) => j.data ?? {}).catch(() => ({}));
        if (d.is_valid === false) return { ok: false, msg: `token ใช้ไม่ได้ (Generate ใหม่): ${d.error?.message ?? ""}` };
        const need = ["instagram_basic", "instagram_manage_messages"].filter((x) => !(d.scopes ?? []).includes(x));
        if (d.scopes && need.length) {
          return { ok: false, msg: `token ยังไม่มีสิทธิ์ ${need.join(", ")} — เพิ่มสิทธิ์ในแอป แล้วไปที่ Messenger > Instagram settings กด Generate token ใหม่ นำมาใส่ช่อง Page access token ของ Instagram` };
        }
      }
      // 2) หา Instagram account ID ให้อัตโนมัติ (ถ้ายังไม่ได้ใส่)
      if (!ig) {
        const j = await fetch(`${GRAPH(fb)}/me?fields=instagram_business_account&access_token=${encodeURIComponent(t)}`)
          .then((x) => x.json()).catch(() => ({}));
        ig = j?.instagram_business_account?.id;
        if (!ig) return { ok: false, msg: "หา Instagram account ID ไม่เจอ — เช็กว่า IG เป็นบัญชีมืออาชีพและเชื่อมกับเพจ TESR แล้ว หรือคัดลอก ID จากหน้า Instagram settings มาใส่เอง" };
        await db.from("channel_configs").update({ config: { ...c.config, ig_user_id: ig } }).eq("channel", "instagram");
      }
      // 3) เพจต้องส่ง field "messages" ให้แอป (DM ของ IG ก็ผ่านเส้นทางนี้) — ถ้ายังไม่ผูก ผูกให้อัตโนมัติ
      const sa = await fetch(`${GRAPH(fb)}/me/subscribed_apps?access_token=${encodeURIComponent(t)}`).then((x) => x.json()).catch(() => ({}));
      const mine = (sa?.data ?? []).find((a: any) => String(a.id) === String(app));
      if (!sa?.error && !(mine?.subscribed_fields ?? []).includes("messages")) {
        await fetch(`${GRAPH(fb)}/me/subscribed_apps?subscribed_fields=messages,messaging_postbacks&access_token=${encodeURIComponent(t)}`, { method: "POST" }).catch(() => null);
      }
      const r = await fetch(`${GRAPH(fb)}/${ig}?fields=username&access_token=${encodeURIComponent(t)}`);
      const j = await r.json().catch(() => ({}));
      return r.ok
        ? { ok: true, msg: `เชื่อมต่อ @${j.username} สำเร็จ (IG ID ${ig})` }
        : { ok: true, msg: `token มีสิทธิ์ Instagram ครบ (IG ID ${ig}) · ทักทาง IG มาทดสอบได้เลย` };
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
  // งานจัดการพนักงานคนอื่น = เฉพาะเจ้าของระบบ (owner)
  if (["list_users", "create_user", "reset_password", "reset_to_phone"].includes(b.action)) {
    const { data: me } = await db.from("staff").select("is_owner").eq("id", admin.id).maybeSingle();
    if (!me?.is_owner) return json({ ok: false, msg: "จัดการพนักงานได้เฉพาะเจ้าของระบบ (owner)" }, 403);
  }
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
        const { email, name, role } = b;
        // รหัสเริ่มต้น = เบอร์โทร (ตัวเลขล้วน) ถ้าไม่ได้กำหนดรหัสมาเอง
        const password = String(b.password || "").trim() || String(b.phone ?? "").replace(/\D/g, "");
        if (!email || password.length < 8) {
          return json({ ok: false, msg: "ต้องมีอีเมล และเบอร์โทร (ใช้เป็นรหัสเริ่มต้น) หรือรหัสผ่านอย่างน้อย 8 ตัว" }, 400);
        }
        const { data, error } = await db.auth.admin.createUser({
          email, password, email_confirm: true, user_metadata: { name: name || email.split("@")[0] },
        });
        if (error) return json({ ok: false, msg: error.message }, 400);
        await db.from("staff").update({
          role: role === "admin" ? "admin" : "agent", // owner ตั้งผ่านฐานข้อมูลเท่านั้น
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
      case "reset_to_phone": {
        // ตั้งรหัสผ่านเป็นเบอร์โทร (ตัวเลขล้วน) — เฉพาะคนที่ยังใช้รหัสเริ่มต้น (ยังไม่เคยเปลี่ยนรหัสเอง)
        // หรือระบุ user_id มาคนเดียว
        let q = db.from("staff").select("id, display_name, phone");
        if (b.user_id) q = q.eq("id", b.user_id);
        const { data: list } = await q;
        const { data: init } = await db.from("staff_initial_pw").select("staff_id");
        const still = new Set((init ?? []).map((r) => r.staff_id));
        const done: string[] = [], skip: string[] = [];
        for (const s of list ?? []) {
          const pw = String(s.phone ?? "").replace(/\D/g, "");
          if (!b.user_id && !still.has(s.id)) continue; // เปลี่ยนรหัสเองแล้ว ไม่ไปยุ่ง
          if (pw.length < 8) { skip.push(`${s.display_name} (ไม่มีเบอร์โทร)`); continue; }
          const { error } = await db.auth.admin.updateUserById(s.id, { password: pw });
          if (error) { skip.push(`${s.display_name} (${error.message})`); continue; }
          await db.from("staff_initial_pw").upsert({ staff_id: s.id, password: pw, set_by: admin.id, set_at: new Date().toISOString() });
          done.push(s.display_name);
        }
        await db.from("activity_log").insert({ actor: admin.id, action: "ตั้งรหัสผ่านเป็นเบอร์โทร", detail: { done, skip } });
        return json({
          ok: done.length > 0 || !skip.length,
          msg: (done.length ? `ตั้งรหัสเป็นเบอร์โทรแล้ว ${done.length} คน` : "ไม่มีใครต้องเปลี่ยน") +
            (skip.length ? ` · ข้าม: ${skip.join(", ")}` : ""),
        });
      }
      default:
        return json({ ok: false, msg: "unknown action" }, 400);
    }
  } catch (e) {
    return json({ ok: false, msg: String((e as Error).message ?? e) }, 500);
  }
});
