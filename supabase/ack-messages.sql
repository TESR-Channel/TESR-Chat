-- TESR Chat — ข้อความ "รับทราบ/ขอบคุณ" ของลูกค้า ไม่นับเป็นแชตที่ต้องตอบ (กัน KPI เวลาตอบเพี้ยน)
-- ใช้เมื่อทีมตอบไปแล้ว (ไม่มีแชตค้างรอตอบ) แล้วลูกค้าส่งคำปิดท้ายสั้น ๆ มา เช่น
--   "ขอบคุณครับ" "รับทราบค่ะ" "โอเคครับ" "ok" "👍" หรือสติกเกอร์อย่างเดียว
-- ถ้าลูกค้ายังมีคำถามค้างอยู่ (awaiting_since ไม่ว่าง) ข้อความแบบนี้ไม่ไปลบสถานะรอตอบ

create or replace function public.is_ack_message(p_type text, p_text text)
returns boolean language plpgsql immutable as $$
declare t text;
begin
  if p_type = 'sticker' then return true; end if;
  if p_type <> 'text' or p_text is null then return false; end if;
  t := lower(btrim(p_text));
  if length(t) = 0 or length(t) > 60 then return false; end if;
  if t ~ '[?？]' then return false; end if;           -- มีเครื่องหมายคำถาม = ยังรอคำตอบ
  -- ตัดเครื่องหมาย/ช่องว่าง/อีโมจิ ออก
  t := regexp_replace(t, '[[:space:][:punct:]]', '', 'g');
  t := regexp_replace(t, '[^a-zก-๙0-9]', '', 'g');
  if t = '' then return true; end if;                  -- อีโมจิ/สัญลักษณ์ล้วน เช่น 👍 🙏 ❤️
  t := regexp_replace(t, 'ๆ', '', 'g');
  t := regexp_replace(t, '(.)\1{2,}', '\1', 'g');      -- ครับบบบ → ครับ, 555555 → 5
  -- ตัดคำลงท้าย/คำสุภาพ
  t := regexp_replace(t, '(ครับผม|ครับ|คับ|ค้าบ|ขอรับ|ค่ะ|คะ|ค่า|คร่า|จ้า|จ้ะ|จ๊ะ|นะ|น้า|ฮะ|ฮ่ะ|เด้อ|เน้อ|ด้วย|เลย|มาก|แล้ว|น่ะ)', '', 'g');
  if t = '' then return true; end if;                  -- "ครับ" / "ค่ะ" เดี่ยว ๆ = รับทราบ
  t := regexp_replace(t, '(พี่|น้อง|แอดมิน|แอด|admin|ทีมงาน|ทุกท่าน)', '', 'g');
  if t = '' then return false; end if;                 -- "พี่ครับ" = เรียกหา ไม่ใช่รับทราบ
  return t ~ '^(ขอบคุณ|ขอบใจ|ขอบพระคุณ|รับทราบ|ทราบ|โอเค|โอเคร|โอเช|ok|okay|okk|kk|k|เค|ได้รับ|ได้|ตกลง|เรียบร้อย|ยินดี|thanks|thank|thankyou|thx|ty|tq|noted|got it|gotit|5|55|555|ค่ะ|ครับ|ดีเลย|เยี่ยม|สุดยอด|ไม่เป็นไร)+$';
end $$;

create or replace function public.ingest_message(p_channel text, p_uid text, p_name text, p_avatar text, p_type text,
  p_text text, p_media text, p_file_name text, p_mid text, p_raw jsonb, p_reply_token text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ack boolean := is_ack_message(p_type, p_text);
begin
  if p_mid is not null and exists (
    select 1 from messages where channel = p_channel and platform_message_id = p_mid
  ) then
    return null;
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
    -- คำปิดท้าย (ขอบคุณ/รับทราบ) หลังทีมตอบแล้ว ไม่ต้องรอตอบ
    awaiting_since      = case when contacts.awaiting_since is null and v_ack then null
                               else coalesce(contacts.awaiting_since, now()) end,
    line_reply_token    = coalesce(p_reply_token, contacts.line_reply_token),
    line_reply_token_at = case when p_reply_token is not null then now() else contacts.line_reply_token_at end
  returning id into v_id;

  insert into messages (contact_id, channel, direction, msg_type, text, media_url, file_name,
                        platform_message_id, raw)
  values (v_id, p_channel, 'in', p_type, p_text, p_media, p_file_name, p_mid,
          case when v_ack then coalesce(p_raw, '{}'::jsonb) || '{"tesr_ack":true}' else p_raw end);

  return v_id;
end $$;

create or replace function public.ingest_message_at(p_channel text, p_uid text, p_name text, p_avatar text, p_type text,
  p_text text, p_media text, p_file_name text, p_mid text, p_raw jsonb, p_at timestamptz)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_at timestamptz := coalesce(p_at, now()); v_ack boolean := is_ack_message(p_type, p_text);
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
    awaiting_since  = case when contacts.awaiting_since is null and v_ack then null
                           else coalesce(contacts.awaiting_since, v_at) end
  returning id into v_id;

  insert into messages (contact_id, channel, direction, msg_type, text, media_url, file_name,
                        platform_message_id, raw, created_at)
  values (v_id, p_channel, 'in', p_type, p_text, p_media, p_file_name, p_mid,
          case when v_ack then coalesce(p_raw, '{}'::jsonb) || '{"tesr_ack":true}' else p_raw end, v_at);

  return v_id;
end $$;

-- แก้ย้อนหลัง: แชตที่ค้าง "รอตอบ" เพราะลูกค้าส่งแค่คำปิดท้ายหลังทีมตอบไปแล้ว
update contacts c set awaiting_since = null
where c.awaiting_since is not null
  and exists (select 1 from messages o where o.contact_id = c.id and o.direction = 'out' and o.created_at <= c.awaiting_since + interval '1 second')
  and not exists (
    select 1 from messages i
    where i.contact_id = c.id and i.direction = 'in'
      and i.created_at >= c.awaiting_since
      and i.created_at > coalesce((select max(o.created_at) from messages o where o.contact_id = c.id and o.direction = 'out'), '-infinity')
      and not is_ack_message(i.msg_type, i.text)
  );
