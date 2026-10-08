-- =====================================================================
-- TESR Chat — Database schema (Supabase / PostgreSQL)
-- วิธีใช้: Supabase Dashboard > SQL Editor > New query > วางทั้งไฟล์ > Run
-- รันซ้ำได้ (idempotent)
-- =====================================================================

-- ---------- พนักงาน (สร้างอัตโนมัติเมื่อสมัคร/เพิ่ม user ใน Auth) ----------
create table if not exists public.staff (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null,
  role          text not null default 'agent' check (role in ('admin','agent')),
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- user คนแรกของระบบ = admin อัตโนมัติ
  insert into staff (id, display_name, role)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
          case when exists (select 1 from staff where role = 'admin') then 'agent' else 'admin' end)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- ลูกค้า (1 แถว = ลูกค้า 1 คน ต่อ 1 ช่องทาง) ----------
create table if not exists public.contacts (
  id                   uuid primary key default gen_random_uuid(),
  channel              text not null check (channel in
                         ('line','facebook','instagram','tiktok','youtube','shopee','lazada')),
  platform_user_id     text not null,
  display_name         text,
  avatar_url           text,
  business_unit        text check (business_unit in ('shop','academy','rnd','logistics','other')),
  assigned_to          uuid references public.staff(id) on delete set null,
  status               text not null default 'open' check (status in ('open','pending','closed')),
  last_text            text,
  last_message_at      timestamptz not null default now(),
  last_in_at           timestamptz,
  unread               int not null default 0,
  awaiting_since       timestamptz,          -- ลูกค้ารอคำตอบตั้งแต่เมื่อไหร่ (null = ตอบแล้ว)
  line_reply_token     text,
  line_reply_token_at  timestamptz,
  created_at           timestamptz not null default now(),
  unique (channel, platform_user_id)
);

-- ---------- ข้อความ ----------
create table if not exists public.messages (
  id                   bigint generated always as identity primary key,
  contact_id           uuid not null references public.contacts(id) on delete cascade,
  channel              text not null,
  direction            text not null check (direction in ('in','out')),
  msg_type             text not null default 'text',   -- text,image,video,audio,file,sticker,location
  text                 text,
  media_url            text,
  file_name            text,
  platform_message_id  text,
  sent_by              uuid references public.staff(id) on delete set null,
  response_seconds     int,                             -- ข้อความขาออก: ใช้เวลาตอบกี่วินาที
  send_status          text not null default 'ok',      -- ok / failed
  send_error           text,
  raw                  jsonb,
  created_at           timestamptz not null default now()
);

create index if not exists messages_contact_time on public.messages (contact_id, created_at);
create index if not exists messages_staff_time   on public.messages (sent_by, created_at) where direction = 'out';
create index if not exists contacts_last_msg     on public.contacts (last_message_at desc);
create unique index if not exists messages_platform_mid
  on public.messages (channel, platform_message_id) where platform_message_id is not null;

-- ---------- โน้ตภายใน (ลูกค้าไม่เห็น) ----------
create table if not exists public.notes (
  id          bigint generated always as identity primary key,
  contact_id  uuid not null references public.contacts(id) on delete cascade,
  author      uuid references public.staff(id) on delete set null,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists notes_contact on public.notes (contact_id, created_at);

-- ---------- ประวัติการเปลี่ยนผู้ดูแล/ฝ่าย (ใช้ดูพฤติกรรมทีม) ----------
create table if not exists public.activity_log (
  id          bigint generated always as identity primary key,
  contact_id  uuid references public.contacts(id) on delete cascade,
  actor       uuid references public.staff(id) on delete set null,
  action      text not null,
  detail      jsonb,
  created_at  timestamptz not null default now()
);

-- ---------- รับข้อความเข้า (เรียกจาก webhook ด้วย service role เท่านั้น) ----------
create or replace function public.ingest_message(
  p_channel text, p_uid text, p_name text, p_avatar text,
  p_type text, p_text text, p_media text, p_file_name text,
  p_mid text, p_raw jsonb, p_reply_token text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_mid is not null and exists (
    select 1 from messages where channel = p_channel and platform_message_id = p_mid
  ) then
    return null;  -- ข้อความซ้ำ
  end if;

  insert into contacts (channel, platform_user_id, display_name, avatar_url,
                        last_text, last_message_at, last_in_at, unread, awaiting_since,
                        line_reply_token, line_reply_token_at)
  values (p_channel, p_uid, coalesce(p_name, p_uid), p_avatar,
          left(coalesce(p_text, '[' || p_type || ']'), 200), now(), now(), 1, now(),
          p_reply_token, case when p_reply_token is not null then now() end)
  on conflict (channel, platform_user_id) do update set
    display_name        = coalesce(p_name, contacts.display_name),
    avatar_url          = coalesce(p_avatar, contacts.avatar_url),
    last_text           = excluded.last_text,
    last_message_at     = now(),
    last_in_at          = now(),
    unread              = contacts.unread + 1,
    status              = case when contacts.status = 'closed' then 'open' else contacts.status end,
    awaiting_since      = coalesce(contacts.awaiting_since, now()),
    line_reply_token    = coalesce(p_reply_token, contacts.line_reply_token),
    line_reply_token_at = case when p_reply_token is not null then now() else contacts.line_reply_token_at end
  returning id into v_id;

  insert into messages (contact_id, channel, direction, msg_type, text, media_url, file_name,
                        platform_message_id, raw)
  values (v_id, p_channel, 'in', p_type, p_text, p_media, p_file_name, p_mid, p_raw);

  return v_id;
end $$;

revoke execute on function public.ingest_message from public, anon, authenticated;
grant  execute on function public.ingest_message to service_role;

-- ---------- บันทึกข้อความขาออก + คำนวณเวลาตอบ ----------
create or replace function public.record_outgoing(
  p_contact uuid, p_staff uuid, p_type text, p_text text, p_media text,
  p_file_name text, p_status text, p_error text
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_wait timestamptz; v_id bigint;
begin
  select awaiting_since into v_wait from contacts where id = p_contact for update;

  insert into messages (contact_id, channel, direction, msg_type, text, media_url, file_name,
                        sent_by, response_seconds, send_status, send_error)
  select p_contact, c.channel, 'out', p_type, p_text, p_media, p_file_name, p_staff,
         case when v_wait is not null and p_status = 'ok'
              then extract(epoch from now() - v_wait)::int end,
         p_status, p_error
  from contacts c where c.id = p_contact
  returning id into v_id;

  if p_status = 'ok' then
    update contacts set
      awaiting_since  = null,
      unread          = 0,
      last_text       = left(coalesce(p_text, '[' || p_type || ']'), 200),
      last_message_at = now(),
      assigned_to     = coalesce(assigned_to, p_staff)   -- คนแรกที่ตอบ = ผู้ดูแลอัตโนมัติ
    where id = p_contact;
  end if;

  return v_id;
end $$;

revoke execute on function public.record_outgoing from public, anon, authenticated;
grant  execute on function public.record_outgoing to service_role;

-- ---------- สถิติพนักงาน (ใช้ในหน้า Dashboard) ----------
create or replace function public.staff_stats(p_from timestamptz, p_to timestamptz)
returns table (
  staff_id uuid, display_name text, replies bigint, customers bigint,
  avg_response_sec numeric, median_response_sec numeric, slow_replies bigint
)
language sql stable security invoker set search_path = public as $$
  select s.id, s.display_name,
         count(m.id)                                   as replies,
         count(distinct m.contact_id)                  as customers,
         round(avg(m.response_seconds))                as avg_response_sec,
         percentile_cont(0.5) within group (order by m.response_seconds)::numeric as median_response_sec,
         count(*) filter (where m.response_seconds > 600) as slow_replies   -- ช้ากว่า 10 นาที
  from staff s
  left join messages m
    on m.sent_by = s.id and m.direction = 'out' and m.send_status = 'ok'
   and m.created_at >= p_from and m.created_at < p_to
  where s.active
  group by s.id, s.display_name
  order by replies desc;
$$;

-- ---------- สิทธิ์ (RLS): เฉพาะพนักงานที่ล็อกอินและ active ----------
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where id = auth.uid() and active);
$$;

alter table public.staff        enable row level security;
alter table public.contacts     enable row level security;
alter table public.messages     enable row level security;
alter table public.notes        enable row level security;
alter table public.activity_log enable row level security;

drop policy if exists staff_read        on public.staff;
drop policy if exists staff_self_update on public.staff;
drop policy if exists contacts_read     on public.contacts;
drop policy if exists contacts_update   on public.contacts;
drop policy if exists messages_read     on public.messages;
drop policy if exists notes_read        on public.notes;
drop policy if exists notes_insert      on public.notes;
drop policy if exists activity_read     on public.activity_log;
drop policy if exists activity_insert   on public.activity_log;

create policy staff_read        on public.staff for select to authenticated using (public.is_staff());
create policy staff_self_update on public.staff for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy contacts_read     on public.contacts for select to authenticated using (public.is_staff());
create policy contacts_update   on public.contacts for update to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy messages_read     on public.messages for select to authenticated using (public.is_staff());
create policy notes_read        on public.notes for select to authenticated using (public.is_staff());
create policy notes_insert      on public.notes for insert to authenticated
  with check (public.is_staff() and author = auth.uid());
create policy activity_read     on public.activity_log for select to authenticated using (public.is_staff());
create policy activity_insert   on public.activity_log for insert to authenticated
  with check (public.is_staff() and actor = auth.uid());

-- พนักงานแก้ role/active ของตัวเองไม่ได้
revoke update on public.staff from authenticated;
grant  update (display_name) on public.staff to authenticated;

-- ---------- Realtime ----------
do $$ begin alter publication supabase_realtime add table public.contacts;
exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.notes;
exception when duplicate_object then null; end $$;

-- ---------- ที่เก็บรูป/ไฟล์ ----------
-- public = จำเป็น เพราะ LINE ต้องดึงรูปจาก URL สาธารณะตอนส่งให้ลูกค้า
-- ชื่อไฟล์เป็น UUID สุ่ม จึงเดา URL ไม่ได้
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', true, 52428800)  -- 50 MB
on conflict (id) do nothing;

drop policy if exists media_staff_upload on storage.objects;
create policy media_staff_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and public.is_staff());

-- =====================================================================
-- ตั้งค่าระบบ (หน้า "ตั้งค่า" ของแอดมิน)
-- =====================================================================

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where id = auth.uid() and active and role = 'admin');
$$;

-- ---------- การเชื่อมต่อแต่ละช่องทาง ----------
-- config  = ค่าทั่วไป (เช่น Page ID) แอดมินอ่านได้
-- secrets = token/secret อ่านได้เฉพาะ Edge Function (service role) เท่านั้น
--           หน้าเว็บเห็นแค่ว่า "ใส่แล้ว / ยังไม่ใส่" ไม่เห็นค่าจริง
create table if not exists public.channel_configs (
  channel        text primary key check (channel in
                   ('line','facebook','instagram','tiktok','youtube','shopee','lazada')),
  enabled        boolean not null default false,
  config         jsonb not null default '{}'::jsonb,
  secrets        jsonb not null default '{}'::jsonb,
  last_test_at   timestamptz,
  last_test_ok   boolean,
  last_test_msg  text,
  updated_by     uuid references public.staff(id) on delete set null,
  updated_at     timestamptz not null default now()
);
alter table public.channel_configs enable row level security;
-- ไม่มี policy = ผู้ใช้ทั่วไปอ่าน/เขียนตรงไม่ได้ ต้องผ่านฟังก์ชันด้านล่าง
revoke all on public.channel_configs from anon, authenticated;

insert into public.channel_configs (channel)
select unnest(array['line','facebook','instagram','tiktok','youtube','shopee','lazada'])
on conflict do nothing;

-- อ่านสถานะทุกช่องทาง (admin) — ไม่ส่งค่า secret กลับไป ส่งแค่ชื่อ key ที่ตั้งแล้ว
create or replace function public.admin_get_channels()
returns table (channel text, enabled boolean, config jsonb, secrets_set text[],
               last_test_at timestamptz, last_test_ok boolean, last_test_msg text,
               updated_at timestamptz, updated_by_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admin only'; end if;
  return query
    select c.channel, c.enabled, c.config,
           coalesce((select array_agg(k) from jsonb_each_text(c.secrets) as e(k, v) where v <> ''), '{}'),
           c.last_test_at, c.last_test_ok, c.last_test_msg, c.updated_at, s.display_name
    from channel_configs c left join staff s on s.id = c.updated_by
    order by array_position(array['line','facebook','instagram','tiktok','youtube','shopee','lazada'], c.channel);
end $$;

-- บันทึก (admin) — secret ที่ส่งมาเป็นค่าว่าง = คงค่าเดิมไว้, ส่ง null = ลบ
create or replace function public.admin_save_channel(
  p_channel text, p_enabled boolean, p_config jsonb, p_secrets jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare v_old jsonb; v_new jsonb; k text; v jsonb;
begin
  if not is_admin() then raise exception 'admin only'; end if;
  select secrets into v_old from channel_configs where channel = p_channel;
  v_new := coalesce(v_old, '{}'::jsonb);
  for k, v in select * from jsonb_each(coalesce(p_secrets, '{}'::jsonb)) loop
    if v = 'null'::jsonb then v_new := v_new - k;
    elsif v #>> '{}' <> '' then v_new := jsonb_set(v_new, array[k], v);
    end if;
  end loop;

  update channel_configs set
    enabled = p_enabled, config = coalesce(p_config, '{}'::jsonb), secrets = v_new,
    updated_by = auth.uid(), updated_at = now()
  where channel = p_channel;

  insert into activity_log (actor, action, detail)
  values (auth.uid(), 'แก้ไขการเชื่อมต่อ ' || p_channel,
          jsonb_build_object('enabled', p_enabled, 'secrets_changed',
            (select coalesce(jsonb_agg(key), '[]') from jsonb_each_text(coalesce(p_secrets,'{}')) where value <> '')));
end $$;

revoke execute on function public.admin_get_channels from public, anon;
revoke execute on function public.admin_save_channel from public, anon;
grant  execute on function public.admin_get_channels to authenticated;
grant  execute on function public.admin_save_channel to authenticated;

-- ---------- ตั้งค่าทั่วไป ----------
create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);
alter table public.app_settings enable row level security;
drop policy if exists settings_read  on public.app_settings;
drop policy if exists settings_write on public.app_settings;
create policy settings_read  on public.app_settings for select to authenticated using (public.is_staff());
create policy settings_write on public.app_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

insert into public.app_settings (key, value) values
  ('slow_reply_min', '10'),
  ('company_name', '"TESR"')
on conflict do nothing;

-- ---------- จัดการพนักงาน (admin) ----------
drop policy if exists staff_admin_update on public.staff;
create policy staff_admin_update on public.staff for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant update (display_name, role, active) on public.staff to authenticated;

-- กันไม่ให้ agent เปลี่ยน role/active เอง และกันแอดมินคนสุดท้ายถูกลดสิทธิ์
create or replace function public.guard_staff_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role or new.active is distinct from old.active) then
    if not is_admin() and auth.uid() is not null then
      raise exception 'เฉพาะแอดมินเท่านั้นที่เปลี่ยนสิทธิ์/สถานะได้';
    end if;
    if old.role = 'admin' and (new.role <> 'admin' or not new.active)
       and (select count(*) from staff where role = 'admin' and active and id <> old.id) = 0 then
      raise exception 'ต้องมีแอดมินอย่างน้อย 1 คน';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists staff_guard on public.staff;
create trigger staff_guard before update on public.staff
  for each row execute function public.guard_staff_update();
