-- TESR Chat — สิทธิ์ 3 ระดับ (ใช้แล้วบนฐานข้อมูลจริง: migration staff_owner_flag)
--   👑 เจ้าของระบบ (staff.is_owner = true, role = admin): ทำได้ทุกอย่าง จัดการพนักงานทุกคน เห็นสถิติ/Export ทุกคน
--   แอดมิน (role = admin): ตั้งค่าช่องทาง / ข้อความลัด / ทั่วไปได้ แต่แก้ได้เฉพาะบัญชีตัวเอง เห็นสถิติของตัวเอง
--   พนักงาน (role = agent): ตอบแชต แก้ได้เฉพาะบัญชีตัวเอง เห็นสถิติของตัวเอง

alter table public.staff add column if not exists is_owner boolean not null default false;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where id = auth.uid() and active and is_owner);
$$;

-- แก้ข้อมูลคนอื่น / เปลี่ยนสิทธิ์ / ปิดบัญชี ได้เฉพาะ owner (ต้องมี owner อย่างน้อย 1 คนเสมอ)
create or replace function public.guard_staff_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not is_owner() then
    if new.id <> auth.uid() then
      raise exception 'แก้ไขข้อมูลพนักงานคนอื่นได้เฉพาะเจ้าของระบบ (owner)';
    end if;
    if new.role is distinct from old.role or new.active is distinct from old.active or new.is_owner is distinct from old.is_owner then
      raise exception 'เฉพาะเจ้าของระบบ (owner) เท่านั้นที่เปลี่ยนสิทธิ์/สถานะได้';
    end if;
  end if;
  if old.is_owner and (not new.is_owner or not new.active or new.role <> 'admin')
     and (select count(*) from staff where is_owner and active and id <> old.id) = 0 then
    raise exception 'ต้องมีเจ้าของระบบ (owner) อย่างน้อย 1 คน';
  end if;
  if new.is_owner then new.role := 'admin'; end if;
  return new;
end $$;

create or replace function public.admin_get_initial_passwords()
returns table(staff_id uuid, password text, set_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_owner() then raise exception 'owner only'; end if;
  return query select p.staff_id, p.password, p.set_at from staff_initial_pw p;
end $$;

-- สถิติรายคน: owner เห็นทุกคน คนอื่นเห็นเฉพาะของตัวเอง
create or replace function public.staff_stats(p_from timestamptz, p_to timestamptz)
returns table(staff_id uuid, display_name text, replies bigint, customers bigint,
              avg_response_sec numeric, median_response_sec numeric, slow_replies bigint)
language sql stable security definer set search_path = public as $$
  select s.id, s.display_name,
         count(m.id), count(distinct m.contact_id), round(avg(m.response_seconds)),
         percentile_cont(0.5) within group (order by m.response_seconds)::numeric,
         count(*) filter (where m.response_seconds > 600)
  from staff s
  left join messages m
    on m.sent_by = s.id and m.direction = 'out' and m.send_status = 'ok'
   and m.created_at >= p_from and m.created_at < p_to
  where s.active and is_staff() and (is_owner() or s.id = auth.uid())
  group by s.id, s.display_name
  order by 3 desc;
$$;

-- ผู้ใช้คนแรกของระบบ = เจ้าของระบบ
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare first_user boolean := not exists (select 1 from staff);
begin
  insert into staff (id, display_name, role, is_owner)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
          case when first_user then 'admin' else 'agent' end, first_user)
  on conflict (id) do nothing;
  return new;
end $$;

update public.staff set is_owner = true
 where id = (select id from auth.users where email = 'ceo.anoney.potter@gmail.com');
