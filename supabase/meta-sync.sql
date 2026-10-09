-- =====================================================================
-- TESR Chat — ดึงข้อความ Facebook / Instagram จากกล่องข้อความเพจทุก 1 นาที
-- (ใช้ระหว่างที่แอป Meta ยังไม่ Publish: webhook จะส่งมาเฉพาะคนที่มีสิทธิ์ในแอป)
-- รันไฟล์นี้หลัง schema.sql แล้ว deploy ฟังก์ชัน meta-sync
-- =====================================================================

-- รับข้อความขาเข้าพร้อมเวลาจริงของข้อความ (ใช้ตอนดึงย้อนหลัง)
create or replace function public.ingest_message_at(
  p_channel text, p_uid text, p_name text, p_avatar text,
  p_type text, p_text text, p_media text, p_file_name text,
  p_mid text, p_raw jsonb, p_at timestamptz
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_at timestamptz := coalesce(p_at, now());
begin
  if p_mid is not null and exists (
    select 1 from messages where channel = p_channel and platform_message_id = p_mid
  ) then
    return null;
  end if;

  insert into contacts (channel, platform_user_id, display_name, avatar_url,
                        last_text, last_message_at, last_in_at, unread, awaiting_since)
  values (p_channel, p_uid, coalesce(p_name, p_uid), p_avatar,
          left(coalesce(p_text, '[' || p_type || ']'), 200), v_at, v_at, 1, v_at)
  on conflict (channel, platform_user_id) do update set
    display_name    = coalesce(p_name, contacts.display_name),
    avatar_url      = coalesce(p_avatar, contacts.avatar_url),
    last_text       = excluded.last_text,
    last_message_at = greatest(contacts.last_message_at, v_at),
    last_in_at      = greatest(contacts.last_in_at, v_at),
    unread          = contacts.unread + 1,
    status          = case when contacts.status = 'closed' then 'open' else contacts.status end,
    awaiting_since  = coalesce(contacts.awaiting_since, v_at)
  returning id into v_id;

  insert into messages (contact_id, channel, direction, msg_type, text, media_url, file_name,
                        platform_message_id, raw, created_at)
  values (v_id, p_channel, 'in', p_type, p_text, p_media, p_file_name, p_mid, p_raw, v_at);

  return v_id;
end $$;
revoke execute on function public.ingest_message_at from public, anon, authenticated;
grant  execute on function public.ingest_message_at to service_role;

-- ข้อความที่เพจตอบลูกค้าจากที่อื่น (Meta Business Suite / แอปเพจ) → บันทึกเป็นข้อความขาออก (ไม่มีชื่อพนักงาน)
-- ถ้าเป็นข้อความที่ส่งจาก TESR Chat เอง (ข้อความตรงกันในช่วง 5 นาที) จะไม่บันทึกซ้ำ
create or replace function public.ingest_page_reply(
  p_channel text, p_uid text, p_type text, p_text text, p_media text, p_file_name text,
  p_mid text, p_raw jsonb, p_at timestamptz
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_c contacts%rowtype; v_id bigint;
begin
  select * into v_c from contacts where channel = p_channel and platform_user_id = p_uid;
  if not found then return null; end if;
  if p_mid is not null and exists (select 1 from messages where channel = p_channel and platform_message_id = p_mid) then
    return null;
  end if;
  update messages set platform_message_id = p_mid
   where id = (select id from messages
                where contact_id = v_c.id and direction = 'out' and platform_message_id is null
                  and coalesce(text, '') = coalesce(p_text, '')
                  and abs(extract(epoch from created_at - p_at)) < 300
                order by created_at desc limit 1)
  returning id into v_id;
  if v_id is not null then return null; end if;

  insert into messages (contact_id, channel, direction, msg_type, text, media_url, file_name,
                        platform_message_id, raw, created_at, send_status)
  values (v_c.id, p_channel, 'out', p_type, p_text, p_media, p_file_name, p_mid, p_raw, p_at, 'ok')
  returning id into v_id;

  update contacts set
    awaiting_since  = case when awaiting_since is not null and awaiting_since <= p_at then null else awaiting_since end,
    unread          = case when awaiting_since is not null and awaiting_since <= p_at then 0 else unread end,
    last_text       = case when p_at >= last_message_at then left(coalesce(p_text, '[' || p_type || ']'), 200) else last_text end,
    last_message_at = greatest(last_message_at, p_at)
  where id = v_c.id;
  return v_id;
end $$;
revoke execute on function public.ingest_page_reply from public, anon, authenticated;
grant  execute on function public.ingest_page_reply to service_role;

-- โลโก้บริษัทสำหรับหน้าล็อกอิน (อ่านได้ก่อนเข้าระบบ คืนแค่ URL รูป)
create or replace function public.public_logo() returns text
language sql stable security definer set search_path = public as $$
  select value #>> '{}' from public.app_settings where key = 'logo_url'
$$;
revoke all on function public.public_logo() from public;
grant execute on function public.public_logo() to anon, authenticated;

-- ตั้งเวลาเรียก meta-sync ทุก 1 นาที (เปลี่ยน <project-ref> เป็นของโปรเจกต์)
create extension if not exists pg_net;
create extension if not exists pg_cron;
insert into public.app_secrets (key, value)
values ('sync_key', encode(extensions.gen_random_bytes(18), 'hex'))
on conflict (key) do nothing;

-- select cron.schedule('tesr-meta-sync', '20 seconds', $$
--   select net.http_post(
--     url := 'https://<project-ref>.supabase.co/functions/v1/meta-sync',
--     headers := jsonb_build_object('Content-Type','application/json','x-sync-key',(select value from public.app_secrets where key='sync_key')),
--     body := '{}'::jsonb, timeout_milliseconds := 55000)
-- $$);

-- ล็อกกันรันซ้อน (meta-sync ใช้)
insert into app_secrets(key, value) values ('meta_sync_lock', '1970-01-01T00:00:00.000Z') on conflict (key) do nothing;

-- ตาราง webhook_events (เก็บ webhook ดิบก่อนประมวลผล) + cron ทำซ้ำ + ตรวจสุขภาพ — ใช้แล้วบนฐานข้อมูลจริง
-- create table public.webhook_events (...): ดู migration webhook_events_durable
-- select cron.schedule('tesr-line-reprocess', '* * * * *', $$ ... /functions/v1/line-webhook?reprocess=1 ... $$);
-- select cron.schedule('tesr-health-check', '*/5 * * * *', $$ ... /functions/v1/health-check ... $$);
