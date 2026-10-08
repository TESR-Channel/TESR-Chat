// TESR Chat — คู่มือตั้งค่าแต่ละช่องทาง (แบบภาพ: ผังขั้นตอน + การ์ดทีละขั้น + เช็กลิสต์ + แก้ปัญหา)
// ใช้ทั้งในหน้า ตั้งค่า > ช่องทาง และหน้า guide.html (เต็มจอ / พิมพ์)
// แก้เนื้อหาคู่มือที่ไฟล์นี้ไฟล์เดียว · {{FN}} = ที่อยู่ Edge Functions ของระบบ (เติมให้อัตโนมัติ)
(function () {
  const PH = {
    line:   { name: "LINE OA Manager",    color: "#06C755", icon: "💬" },
    lined:  { name: "LINE Developers",    color: "#0b8f47", icon: "🛠" },
    meta:   { name: "Meta for Developers", color: "#1877F2", icon: "🧩" },
    ig:     { name: "แอป Instagram",       color: "#E4405F", icon: "📱" },
    tesr:   { name: "TESR Chat",           color: "#e5322d", icon: "🔴" },
    test:   { name: "ทดสอบ",              color: "#7c3aed", icon: "✅" },
    live:   { name: "เปิดใช้จริง",          color: "#d97706", icon: "🚀" },
    plat:   { name: "แพลตฟอร์มผู้ให้บริการ",  color: "#475569", icon: "🏢" },
  };

  const META_HOOK = "{{FN}}meta-webhook";
  const LINE_HOOK = "{{FN}}line-webhook";

  const G = {
    // =================================================================== LINE
    line: {
      time: "ประมาณ 10–15 นาที",
      need: ["สิทธิ์ Admin ของ LINE OA ของ TESR", "บัญชี LINE ที่ล็อกอิน LINE Developers ได้", "สิทธิ์แอดมินใน TESR Chat"],
      steps: [
        { ph: "line", title: "เปิดใช้ Messaging API",
          where: ["manager.line.biz", "เลือกบัญชี TESR", "ตั้งค่า (มุมขวาบน)", "Messaging API"],
          url: "https://manager.line.biz",
          do: ["กด <b>ใช้ Messaging API</b>", "เลือก Provider ชื่อ <b>TESR</b> (ถ้ายังไม่มีให้สร้างใหม่) แล้วกดตกลง"],
          ok: "หน้า Messaging API ขึ้น Channel ID และสถานะ \"ใช้งาน\"",
          tip: "ทำครั้งเดียว ถ้าเคยเปิดแล้วข้ามได้" },
        { ph: "line", title: "ตั้งการตอบกลับ ให้ข้อความส่งเข้าระบบ",
          where: ["manager.line.biz", "ตั้งค่า", "การตั้งค่าการตอบกลับ"],
          url: "https://manager.line.biz",
          do: ["เปิด <b>Webhook</b>", "ปิด <b>ข้อความตอบกลับอัตโนมัติ</b> (กันลูกค้าได้ข้อความซ้ำ)",
               "แชต: เปิดไว้ได้ (ตอบจาก LINE OA Manager ได้เหมือนเดิม แต่ข้อความที่ตอบจากที่นั่นจะไม่ถูกบันทึกใน TESR Chat)"],
          warn: "ถ้าไม่เปิด Webhook ข้อความจะไม่เข้าระบบเลย" },
        { ph: "line", title: "อนุญาตให้ OA อยู่ในกลุ่มได้ (ถ้าจะตอบแชตกลุ่ม)",
          where: ["manager.line.biz", "ตั้งค่า", "ตั้งค่าบัญชี", "ฟีเจอร์"],
          do: ["เปิด <b>อนุญาตให้บัญชีเข้าร่วมแชทกลุ่ม</b>", "เชิญ LINE OA ของ TESR เข้ากลุ่มลูกค้า"],
          tip: "ระบบรวมทั้งกลุ่มเป็นแชตเดียว และแสดงชื่อคนพูดให้อัตโนมัติ" },
        { ph: "lined", title: "คัดลอก Channel secret",
          where: ["developers.line.biz/console", "Provider: TESR", "Channel ของ OA", "แท็บ Basic settings"],
          url: "https://developers.line.biz/console/",
          do: ["เลื่อนหา <b>Channel secret</b> แล้วกดคัดลอก"],
          copy: [{ from: "Channel secret", to: "LINE OA › Channel secret" }] },
        { ph: "lined", title: "ออก Channel access token",
          where: ["developers.line.biz/console", "Channel ของ OA", "แท็บ Messaging API", "ล่างสุด"],
          do: ["ที่ <b>Channel access token (long-lived)</b> กด <b>Issue</b>", "กดคัดลอก token ที่ได้"],
          copy: [{ from: "Channel access token", to: "LINE OA › Channel access token" }],
          warn: "ถ้ากด Reissue ภายหลัง token เดิมจะใช้ไม่ได้ ต้องนำตัวใหม่มาใส่ TESR Chat ทันที" },
        { ph: "tesr", title: "วางค่าใน TESR Chat แล้วบันทึก",
          where: ["TESR Chat", "ตั้งค่า", "ช่องทาง", "LINE"],
          do: ["วาง Channel secret และ Channel access token", "ติ๊ก <b>เปิดใช้งานช่องทางนี้</b>", "กด <b>💾 บันทึก</b> (ระบบทดสอบให้อัตโนมัติ)"],
          ok: "ขึ้น \"เชื่อมต่อ TESR (@…) สำเร็จ\"" },
        { ph: "tesr", title: "ตั้ง Webhook อัตโนมัติ",
          where: ["TESR Chat", "ตั้งค่า", "LINE"],
          do: ["กด <b>🔗 ตั้ง Webhook อัตโนมัติ</b>", "กลับไป LINE Developers › แท็บ Messaging API › Webhook settings ตรวจว่า <b>Use webhook</b> เปิดอยู่"],
          val: [{ label: "Webhook URL (ถ้าจะวางเอง)", value: LINE_HOOK }],
          ok: "กด ✓ ทดสอบการเชื่อมต่อ แล้วขึ้น \"… · Webhook ✓\"" },
        { ph: "test", title: "ทดสอบรับ–ส่ง",
          do: ["ใช้มือถือทัก LINE OA ของ TESR", "ข้อความต้องเด้งเข้า TESR Chat ภายในไม่กี่วินาที", "ตอบกลับจาก TESR Chat แล้วดูว่าถึงมือถือ"],
          tip: "ตอบภายใน ~1 นาทีหลังลูกค้าทัก = ไม่กินโควตาข้อความ · ช้ากว่านั้นระบบใช้ Push ซึ่งนับโควตาแพ็กเกจ LINE OA" },
      ],
      trouble: [
        { q: "ลูกค้าทักแล้วไม่มีข้อความเข้า", a: "เช็กข้อ 2 (Webhook ต้องเปิด) และข้อ 7 (Use webhook ต้องเปิด) แล้วกด ✓ ทดสอบการเชื่อมต่อ ต้องเห็น Webhook ✓" },
        { q: "ลูกค้าได้ข้อความตอบ 2 รอบ", a: "ปิด \"ข้อความตอบกลับอัตโนมัติ\" ใน LINE OA Manager (ข้อ 2)" },
        { q: "ตอบในกลุ่มแล้วไม่เข้ากลุ่ม", a: "ดูว่าหัวแชตมีคำว่า \"· กลุ่ม\" ถ้าไม่มีแปลว่าเป็นแชตส่วนตัวของคนในกลุ่ม ให้ตอบในแชตที่เป็นกลุ่ม" },
        { q: "ส่งไฟล์ PDF แล้วลูกค้าได้เป็นลิงก์", a: "LINE ไม่ให้ระบบส่งไฟล์ตรง ๆ จึงส่งเป็นลิงก์ดาวน์โหลด (รูป JPG/PNG และวิดีโอ MP4 ส่งเป็นรูป/วิดีโอได้ปกติ)" },
      ],
    },

    // =================================================================== FACEBOOK
    facebook: {
      time: "ประมาณ 20–30 นาที (ไม่รวมรอ App Review)",
      need: ["เป็นแอดมินเพจ Facebook ของ TESR", "บัญชี Meta for Developers (ใช้เฟซบุ๊กเดียวกัน)", "สิทธิ์แอดมินใน TESR Chat"],
      steps: [
        { ph: "meta", title: "สร้างแอป (ทำครั้งเดียว)",
          where: ["developers.facebook.com/apps", "Create App"],
          url: "https://developers.facebook.com/apps",
          do: ["ตั้งชื่อแอป เช่น <b>TESR Chat</b>",
               "เลือก use case <b>Engage with customers on Messenger from Meta</b>",
               "ผูกกับ Business Portfolio ของ TESR แล้วกดสร้าง"],
          warn: "ถ้าแอปเดิมสร้างด้วย use case อื่น (เช่น Facebook Login for Business) ให้ไปที่ Use cases › Add use case แล้วเพิ่ม Messenger" },
        { ph: "meta", title: "คัดลอก App ID และ App secret",
          where: ["แอป TESR Chat", "App settings", "Basic"],
          do: ["คัดลอก <b>App ID</b>", "ที่ App secret กด <b>Show</b> แล้วคัดลอก"],
          copy: [{ from: "App ID", to: "Facebook › App ID" }, { from: "App secret", to: "Facebook › App secret" }] },
        { ph: "meta", title: "เชื่อมเพจ และสร้าง Page access token",
          where: ["Use cases", "Messenger from Meta", "Customize", "Messenger API Settings", "2. Generate access tokens"],
          do: ["กด <b>Add Page</b> เลือกเพจ TESR แล้วกดอนุญาตทุกข้อ",
               "แถวเพจจะขึ้นชื่อเพจ และ<b>ตัวเลขใต้ชื่อ = Page ID</b>",
               "กด <b>Generate</b> ติ๊กยอมรับ แล้วคัดลอก token"],
          copy: [{ from: "ตัวเลขใต้ชื่อเพจ", to: "Facebook › Page ID" }, { from: "Token ที่ Generate", to: "Facebook › Page access token" }],
          warn: "Meta แสดง token ให้ดูครั้งเดียว คัดลอกทันทีก่อนปิดหน้าต่าง" },
        { ph: "tesr", title: "วางค่าใน TESR Chat แล้วบันทึก",
          where: ["TESR Chat", "ตั้งค่า", "ช่องทาง", "Facebook"],
          do: ["วาง App ID, App secret, Page ID, Page access token",
               "ช่อง Verify token กด <b>🎲</b> ให้สุ่มค่า แล้ว<b>คัดลอกค่านั้นไว้</b> (ใช้ในข้อถัดไป)",
               "ติ๊ก <b>เปิดใช้งานช่องทางนี้</b> แล้วกด <b>💾 บันทึก</b>"],
          ok: "ขึ้น \"Page token ถูกต้อง (เพจ ID …)\"",
          tip: "ต้องบันทึกใน TESR Chat ก่อน ไม่งั้นขั้นต่อไปกด Verify and save จะไม่ผ่าน" },
        { ph: "meta", title: "ผูก Webhook (ให้ Meta ส่งข้อความมาที่ระบบ)",
          where: ["Messenger API Settings", "1. Configure webhooks"],
          do: ["วาง Callback URL และ Verify token (ค่าเดียวกับใน TESR Chat)", "กด <b>Verify and save</b>",
               "ในตาราง Webhook fields เปิดสวิตช์ <b>messages</b> และ <b>messaging_postbacks</b> ให้เป็น Subscribed"],
          val: [{ label: "Callback URL", value: META_HOOK }],
          ok: "หัวข้อ 1. Configure webhooks มีเครื่องหมายถูกสีเขียว" },
        { ph: "meta", title: "ให้เพจรับข้อความ (Page subscriptions)",
          where: ["Messenger API Settings", "2. Generate access tokens", "แถวเพจ TESR"],
          do: ["ช่อง Webhook Subscription กด <b>See Full … fields</b> (หรือไอคอนแก้ไข)",
               "ติ๊ก <b>messages</b> และ <b>messaging_postbacks</b> แล้วกด <b>Confirm</b>",
               "หรือกดปุ่ม <b>🔗 ผูกเพจกับแอป</b> ใน TESR Chat แทนได้"],
          ok: "แถวเพจขึ้น \"messages and messaging_postbacks\"" },
        { ph: "test", title: "ทดสอบ",
          do: ["TESR Chat › Facebook กด <b>✓ ทดสอบการเชื่อมต่อ</b>",
               "ใช้เฟซบุ๊ก<b>ของคนที่มีสิทธิ์ในแอป</b> (เช่นของคุณเอง) ทักเพจ TESR",
               "ข้อความต้องเข้า TESR Chat และตอบกลับได้"],
          ok: "ขึ้น \"Page token ถูกต้อง · รับข้อความ Messenger ✓\"",
          tip: "ช่วงที่แอปยังไม่ Publish คนทั่วไปทักมาจะยังไม่เข้า (ปกติ)" },
        { ph: "live", title: "เตรียมส่งตรวจ และเปิดให้ลูกค้าทุกคน",
          where: ["App settings", "Basic"],
          do: ["App domains: <code>tesr-channel.github.io</code>",
               "Privacy policy URL และ User data deletion (เลือก Data deletion instructions URL) ใช้ค่าด้านล่าง",
               "Category: <b>Business and pages</b> · App icon: รูป 1024×1024",
               "App Review › ขอ Advanced Access ของ <b>pages_messaging</b> › เมื่อผ่านแล้วกด <b>Publish</b>",
               "ทำ Business Verification ใน Meta Business Settings (ใช้หนังสือรับรองบริษัท)"],
          val: [{ label: "Privacy policy URL", value: "https://tesr-channel.github.io/TESR-Chat/privacy.html" },
                { label: "Data deletion URL", value: "https://tesr-channel.github.io/TESR-Chat/privacy.html#delete" }],
          warn: "Meta ให้ตอบลูกค้าได้ภายใน 24 ชม. หลังลูกค้าทักล่าสุด" },
      ],
      trouble: [
        { q: "กด Verify and save แล้วไม่ผ่าน", a: "Verify token ใน Meta ต้องตรงกับใน TESR Chat ทุกตัวอักษร และต้องกดบันทึกใน TESR Chat ก่อน" },
        { q: "ทดสอบขึ้น \"token นี้สร้างจากแอปอื่น\" / \"ไม่ใช่ PAGE token\"", a: "ต้องกด Generate ที่แถวเพจในหน้า Messenger API Settings ของแอป TESR Chat เท่านั้น (ไม่ใช่ token จาก Graph API Explorer)" },
        { q: "ทักเพจแล้วไม่มีข้อความเข้า", a: "1) แอปยังไม่ Publish → ต้องทักจากบัญชีที่มีสิทธิ์ในแอป 2) field messages ยังไม่ Subscribed (ข้อ 5 และ 6)" },
        { q: "ตอบแล้วขึ้น \"เกิน 24 ชม.\"", a: "กฎของ Meta: ตอบได้ภายใน 24 ชม. หลังลูกค้าทักล่าสุด ให้รอลูกค้าทักมาใหม่" },
        { q: "ตอบจาก Meta Business Suite แล้วไม่เห็นใน TESR Chat", a: "ระบบบันทึกเฉพาะข้อความที่ตอบจาก TESR Chat ให้ทีมตอบจากที่นี่ที่เดียว" },
      ],
    },

    // =================================================================== INSTAGRAM
    instagram: {
      time: "ประมาณ 15–20 นาที (ต้องตั้ง Facebook เสร็จก่อน)",
      need: ["ตั้งค่า Facebook ใน TESR Chat เสร็จแล้ว (ใช้แอปเดียวกัน)", "มือถือที่ล็อกอิน IG ของ TESR", "IG ต้องเชื่อมกับเพจ Facebook ของ TESR"],
      steps: [
        { ph: "ig", title: "เตรียมบัญชี IG",
          where: ["แอป Instagram", "โปรไฟล์ TESR", "☰ เมนู"],
          do: ["เปลี่ยนเป็น <b>บัญชีมืออาชีพ (ธุรกิจ)</b> ถ้ายังไม่ได้เปลี่ยน",
               "เชื่อมกับเพจ Facebook ของ TESR (Accounts Center หรือจากเพจ › ตั้งค่า › บัญชีที่เชื่อมโยง › Instagram)"] },
        { ph: "ig", title: "อนุญาตให้ระบบเข้าถึงข้อความ",
          where: ["แอป Instagram", "การตั้งค่า", "ข้อความและการตอบกลับเรื่องราว", "การควบคุมข้อความ", "เครื่องมือที่เชื่อมต่อ"],
          do: ["เปิด <b>อนุญาตการเข้าถึงข้อความ</b>"],
          warn: "ถ้าไม่เปิด Meta จะไม่ส่ง DM มาให้ระบบเลย" },
        { ph: "meta", title: "เพิ่มสิทธิ์ Instagram ให้แอป",
          where: ["Use cases", "Messenger from Meta", "Customize", "Permissions and features"],
          do: ["รายการเรียงตามตัวอักษร กด <b>Ctrl+F</b> พิมพ์ <code>instagram</code>",
               "กด <b>+ Add</b> ที่ <b>instagram_basic</b>", "กด <b>+ Add</b> ที่ <b>instagram_manage_messages</b>"],
          ok: "ทั้ง 2 ตัวขึ้น \"Ready for testing\" สีน้ำเงิน",
          tip: "ถ้าข้ามข้อนี้ ขั้นต่อไปจะขึ้น error \"Invalid Scopes\"" },
        { ph: "meta", title: "เชื่อมบัญชี IG กับแอป",
          where: ["Messenger from Meta", "Customize", "Instagram settings", "Access tokens"],
          do: ["กด <b>Add or remove Pages</b>", "เลือกเพจ TESR <b>และบัญชี IG ของ TESR</b> แล้วกดอนุญาตทุกข้อ"],
          ok: "มีแถวบัญชี IG ขึ้นมาในหน้า Instagram settings" },
        { ph: "meta", title: "สร้าง token สำหรับ IG",
          where: ["Instagram settings", "Access tokens", "แถวบัญชี IG"],
          do: ["กด <b>Generate</b> แล้วคัดลอก token"],
          copy: [{ from: "Token ที่ Generate", to: "Instagram › Page access token" }],
          warn: "Meta แสดง token ให้ดูครั้งเดียว" },
        { ph: "tesr", title: "วางค่าใน TESR Chat แล้วบันทึก",
          where: ["TESR Chat", "ตั้งค่า", "ช่องทาง", "Instagram"],
          do: ["วาง token ในช่อง <b>Page access token</b>",
               "ช่อง Instagram account ID <b>เว้นว่างได้</b> (ระบบหาให้เอง)",
               "ติ๊ก <b>เปิดใช้งานช่องทางนี้</b> แล้วกด <b>💾 บันทึก</b>"],
          ok: "ขึ้น \"เชื่อมต่อ @ชื่อบัญชี สำเร็จ\"" },
        { ph: "meta", title: "ผูก Webhook ของ Instagram",
          where: ["Instagram settings", "Webhooks"],
          do: ["กด <b>Add callback URL</b>", "วาง Callback URL ด้านล่าง และ Verify token <b>ค่าเดียวกับของ Facebook</b>",
               "กด <b>Verify and save</b> แล้วเปิด Subscribe ที่ field <b>messages</b>"],
          val: [{ label: "Callback URL", value: META_HOOK }] },
        { ph: "test", title: "ทดสอบ",
          do: ["ใช้ IG ของคนที่มีสิทธิ์ในแอป ทัก DM ไปที่ IG ของ TESR", "ข้อความต้องเข้า TESR Chat และตอบกลับได้"] },
        { ph: "live", title: "เปิดให้ลูกค้าทุกคน",
          where: ["App Review"],
          do: ["ขอ Advanced Access ของ <b>instagram_manage_messages</b> และ <b>instagram_basic</b>", "ผ่านแล้วกด <b>Publish</b> (แอปเดียวกับ Facebook)"] },
      ],
      trouble: [
        { q: "\"Invalid Scopes: instagram_manage_messages, instagram_basic\"", a: "ยังไม่ได้ทำข้อ 3 (เพิ่มสิทธิ์ในแอป)" },
        { q: "ทดสอบขึ้น \"หา Instagram account ID ไม่เจอ\"", a: "IG ยังไม่ใช่บัญชีมืออาชีพ หรือยังไม่ได้เชื่อมกับเพจ TESR (ข้อ 1) หรือใส่ token ของ Facebook ที่ไม่มีสิทธิ์ IG — ให้ใช้ token จากข้อ 5" },
        { q: "ทดสอบขึ้น \"token ยังไม่มีสิทธิ์ instagram_…\"", a: "ทำข้อ 3 แล้วกด Generate token ใหม่ (ข้อ 5) นำมาใส่แทนตัวเดิม" },
        { q: "Graph API Explorer ได้ \"data\": []", a: "ไม่ต้องใช้วิธีนี้ ทำตามข้อ 4–6 แทน" },
        { q: "ส่ง PDF ทาง IG ไม่ได้", a: "IG รับเฉพาะรูป/วิดีโอ/เสียง ระบบจะส่งไฟล์อื่นเป็นลิงก์ให้อัตโนมัติ" },
      ],
    },

    // =================================================================== TIKTOK
    tiktok: {
      time: "ต้องรอ TikTok อนุมัติ (หลายวัน)",
      soon: true,
      need: ["บัญชี TikTok ของ TESR", "บัญชี TikTok Business Center"],
      steps: [
        { ph: "plat", title: "เปลี่ยนเป็น Business Account", where: ["แอป TikTok", "โปรไฟล์", "การตั้งค่าและความเป็นส่วนตัว", "บัญชี"],
          do: ["สลับเป็น <b>บัญชีธุรกิจ</b>", "ตั้ง <b>ข้อความโดยตรง</b> ให้รับจากทุกคน"] },
        { ph: "plat", title: "เชื่อม Business Center", where: ["business.tiktok.com"], url: "https://business.tiktok.com",
          do: ["สร้าง/เข้า Business Center ของ TESR แล้วเพิ่มบัญชี TikTok"] },
        { ph: "plat", title: "ขอสิทธิ์ Business Messaging API", where: ["business-api.tiktok.com/portal"], url: "https://business-api.tiktok.com/portal",
          do: ["สมัคร developer › สร้างแอป › ขอสิทธิ์ <b>Business Messaging</b>"], tip: "ต้องรอ TikTok อนุมัติ" },
        { ph: "tesr", title: "บันทึกค่าเตรียมไว้", where: ["TESR Chat", "ตั้งค่า", "TikTok"],
          do: ["ใส่ App key, App secret, Business account ID, Access token แล้วบันทึก"], tip: "ตัวเชื่อมต่อจะเปิดในเฟสถัดไป" },
      ],
      trouble: [{ q: "ข้อจำกัด", a: "TikTok ให้ตอบได้ภายใน 48 ชม. และร้านทักลูกค้าก่อนไม่ได้" }],
    },

    // =================================================================== YOUTUBE
    youtube: {
      time: "ประมาณ 10 นาที",
      soon: true,
      need: ["บัญชี Google ที่เป็นเจ้าของช่อง YouTube ของ TESR"],
      steps: [
        { ph: "plat", title: "เข้าใจก่อน", do: ["YouTube <b>ไม่มีระบบ DM</b> ระบบจะดึง <b>คอมเมนต์</b> ใต้คลิปมาเป็นแชตแทน"] },
        { ph: "plat", title: "สร้าง API key", where: ["Google Cloud Console", "APIs & Services", "Library", "YouTube Data API v3"],
          url: "https://console.cloud.google.com/apis/library/youtube.googleapis.com",
          do: ["กด <b>Enable</b>", "ไปที่ Credentials › <b>Create credentials › API key</b> แล้วคัดลอก"],
          copy: [{ from: "API key", to: "YouTube › YouTube Data API key" }] },
        { ph: "plat", title: "หา Channel ID", where: ["YouTube Studio", "การตั้งค่า", "ช่อง", "การตั้งค่าขั้นสูง"],
          do: ["คัดลอก <b>รหัสช่อง</b> (ขึ้นต้นด้วย UC…)"], copy: [{ from: "รหัสช่อง", to: "YouTube › Channel ID" }] },
        { ph: "tesr", title: "บันทึกและทดสอบ", where: ["TESR Chat", "ตั้งค่า", "YouTube"],
          do: ["วางค่า แล้วกดบันทึก และ ✓ ทดสอบ"], ok: "ขึ้น \"พบช่อง …\"", tip: "ตัวดึงคอมเมนต์จะเปิดในเฟสถัดไป" },
      ],
      trouble: [],
    },

    // =================================================================== SHOPEE
    shopee: {
      time: "ต้องรอ Shopee อนุมัติ",
      soon: true,
      need: ["บัญชีผู้ขาย TESR Shop", "เอกสารบริษัทสำหรับสมัคร Open Platform"],
      steps: [
        { ph: "plat", title: "สมัคร Shopee Open Platform", where: ["open.shopee.com"], url: "https://open.shopee.com",
          do: ["สมัครในนามบริษัท ประเภท <b>Seller in-house system</b>"] },
        { ph: "plat", title: "สร้างแอปและขอ SellerChat API", do: ["สร้างแอป แล้วขอสิทธิ์ <b>SellerChat API</b>"], tip: "ต้องรอ Shopee อนุมัติ" },
        { ph: "plat", title: "Authorize ร้าน", do: ["Authorize ร้าน TESR Shop กับแอป แล้วจดค่า Partner ID / Key / Shop ID / Token"] },
        { ph: "tesr", title: "บันทึกค่าเตรียมไว้", where: ["TESR Chat", "ตั้งค่า", "Shopee"], do: ["ใส่ค่าทั้งหมดแล้วบันทึก"], tip: "ตัวเชื่อมต่อจะเปิดในเฟสถัดไป" },
      ],
      trouble: [],
    },

    // =================================================================== LAZADA
    lazada: {
      time: "ต้องรอ Lazada อนุมัติ",
      soon: true,
      need: ["บัญชีผู้ขาย TESR บน Lazada"],
      steps: [
        { ph: "plat", title: "สมัคร Lazada Open Platform", where: ["open.lazada.com"], url: "https://open.lazada.com",
          do: ["สร้างแอปประเภท <b>Seller In-house APP</b>"] },
        { ph: "plat", title: "ขอสิทธิ์ IM API", do: ["ขอสิทธิ์ <b>IM (Instant Messaging) API</b>"], tip: "ต้องรอ Lazada อนุมัติ" },
        { ph: "plat", title: "Authorize ร้าน", do: ["Authorize ร้าน TESR แล้วจดค่า App key / Secret / Seller ID / Token"] },
        { ph: "tesr", title: "บันทึกค่าเตรียมไว้", where: ["TESR Chat", "ตั้งค่า", "Lazada"], do: ["ใส่ค่าทั้งหมดแล้วบันทึก"], tip: "ตัวเชื่อมต่อจะเปิดในเฟสถัดไป" },
      ],
      trouble: [],
    },
  };

  // ------------------------------------------------------------------ render
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const KEY = (ch, i) => `tesr-guide:${ch}:${i}`;
  const isDone = (ch, i) => { try { return localStorage.getItem(KEY(ch, i)) === "1"; } catch (_) { return false; } };

  function flow(g) {
    // รวมขั้นที่อยู่ช่วงเดียวกันติดกันเป็นกล่องเดียว
    const groups = [];
    g.steps.forEach((s, i) => {
      const last = groups[groups.length - 1];
      if (last && last.ph === s.ph) last.to = i + 1;
      else groups.push({ ph: s.ph, from: i + 1, to: i + 1 });
    });
    return `<div class="g-flow">${groups.map((x, k) => {
      const p = PH[x.ph];
      return `${k ? `<span class="g-arrow" aria-hidden="true">→</span>` : ""}<div class="g-node" style="--c:${p.color}">
        <span class="g-node-i">${p.icon}</span><span class="g-node-t">${esc(p.name)}</span>
        <span class="g-node-n">ขั้น ${x.from}${x.to > x.from ? `–${x.to}` : ""}</span></div>`;
    }).join("")}</div>`;
  }

  function step(ch, s, i) {
    const p = PH[s.ph];
    const done = isDone(ch, i);
    return `<li class="g-step${done ? " done" : ""}" style="--c:${p.color}">
      <div class="g-num">${i + 1}</div>
      <div class="g-body">
        <div class="g-head"><span class="g-ph">${p.icon} ${esc(p.name)}</span>
          <label class="g-check"><input type="checkbox" data-gstep="${ch}:${i}"${done ? " checked" : ""}> ทำแล้ว</label></div>
        <div class="g-title">${esc(s.title)}</div>
        ${s.where ? `<div class="g-where">📍 ${s.where.map((w) => `<span>${esc(w)}</span>`).join(`<i>›</i>`)}
          ${s.url ? ` <a href="${esc(s.url)}" target="_blank" rel="noopener" class="g-open">เปิดหน้านี้ ↗</a>` : ""}</div>` : ""}
        ${s.do ? `<ul class="g-do">${s.do.map((d) => `<li>${d}</li>`).join("")}</ul>` : ""}
        ${s.copy ? `<div class="g-copy">${s.copy.map((c) => `<div class="g-map"><span class="g-from">${esc(c.from)}</span><span class="g-to-arrow">คัดลอกไปวางที่ →</span><span class="g-to">TESR Chat › ${esc(c.to)}</span></div>`).join("")}</div>` : ""}
        ${s.val ? s.val.map((v) => `<div class="g-val"><span class="g-val-l">${esc(v.label)}</span><code>${esc(v.value)}</code><button type="button" class="g-cp" data-gcopy="${esc(v.value)}">คัดลอก</button></div>`).join("") : ""}
        ${s.ok ? `<div class="g-note ok">✅ <b>สำเร็จเมื่อ:</b> ${esc(s.ok)}</div>` : ""}
        ${s.tip ? `<div class="g-note tip">💡 ${esc(s.tip)}</div>` : ""}
        ${s.warn ? `<div class="g-note warn">❗ ${esc(s.warn)}</div>` : ""}
      </div></li>`;
  }

  function render(ch, ctx = {}) {
    const g = G[ch];
    if (!g) return "";
    const n = g.steps.filter((_, i) => isDone(ch, i)).length;
    const html = `<div class="g-wrap" data-guide="${ch}">
      <div class="g-top">
        <span class="g-chip">⏱ ${esc(g.time)}</span>${g.soon ? `<span class="g-chip soon">ตัวเชื่อมต่อเปิดในเฟสถัดไป</span>` : ""}
        <span class="g-prog"><span class="g-bar"><span style="width:${Math.round(n / g.steps.length * 100)}%"></span></span>
          <span class="g-prog-t">ทำแล้ว ${n}/${g.steps.length}</span></span>
        ${ctx.full ? "" : `<a class="g-full" href="guide.html#${ch}" target="_blank" rel="noopener">เปิดคู่มือเต็มจอ / พิมพ์ ↗</a>`}
      </div>
      <div class="g-need"><b>เตรียมก่อนเริ่ม:</b> ${g.need.map((x) => `<span>☐ ${esc(x)}</span>`).join("")}</div>
      ${flow(g)}
      <ol class="g-steps">${g.steps.map((s, i) => step(ch, s, i)).join("")}</ol>
      ${g.trouble?.length ? `<details class="g-trouble"${ctx.full ? " open" : ""}><summary>🧯 ติดปัญหา? (${g.trouble.length} อาการที่เจอบ่อย)</summary>
        <dl>${g.trouble.map((t) => `<dt>${esc(t.q)}</dt><dd>${esc(t.a)}</dd>`).join("")}</dl></details>` : ""}
    </div>`;
    return html.replaceAll("{{FN}}", ctx.fn || "");
  }

  // ------------------------------------------------------------------ interactions
  document.addEventListener("change", (e) => {
    const cb = e.target.closest?.("input[data-gstep]"); if (!cb) return;
    const [ch, i] = cb.dataset.gstep.split(":");
    try { cb.checked ? localStorage.setItem(KEY(ch, i), "1") : localStorage.removeItem(KEY(ch, i)); } catch (_) {}
    cb.closest(".g-step")?.classList.toggle("done", cb.checked);
    const wrap = cb.closest(".g-wrap"); const g = G[ch];
    if (wrap && g) {
      const n = g.steps.filter((_, k) => isDone(ch, k)).length;
      wrap.querySelector(".g-bar > span").style.width = Math.round(n / g.steps.length * 100) + "%";
      wrap.querySelector(".g-prog-t").textContent = `ทำแล้ว ${n}/${g.steps.length}`;
    }
  });
  document.addEventListener("click", (e) => {
    const b = e.target.closest?.("[data-gcopy]"); if (!b) return;
    const v = b.dataset.gcopy;
    (navigator.clipboard?.writeText(v) ?? Promise.reject()).then(
      () => { const t = b.textContent; b.textContent = "คัดลอกแล้ว ✓"; setTimeout(() => (b.textContent = t), 1400); },
      () => prompt("คัดลอกค่านี้", v));
  });

  // ------------------------------------------------------------------ styles (ใช้สีธีมของหน้า: --panel --bg --line --ink --muted)
  const css = `
  .g-wrap{display:grid;gap:14px;margin-top:12px}
  .g-top{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
  .g-chip{font-size:12px;padding:3px 10px;border-radius:999px;background:var(--bg);border:1px solid var(--line)}
  .g-chip.soon{background:#d9770620;border-color:#d9770660}
  .g-prog{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted)}
  .g-bar{width:120px;height:8px;border-radius:99px;background:var(--line);overflow:hidden;display:inline-block}
  .g-bar>span{display:block;height:100%;background:#16a34a;transition:width .3s}
  .g-full{margin-left:auto;font-size:13px;color:var(--brand,#e5322d);text-decoration:none;font-weight:600}
  .g-need{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:13px;background:var(--bg);border-radius:10px;padding:10px 12px}
  .g-need b{width:100%}
  .g-flow{display:flex;flex-wrap:wrap;align-items:stretch;gap:6px}
  .g-node{flex:1 1 120px;min-width:110px;border:2px solid var(--c);border-radius:12px;padding:8px 10px;display:grid;gap:2px;
    background:color-mix(in srgb,var(--c) 10%,transparent)}
  .g-node-i{font-size:18px}.g-node-t{font-weight:700;font-size:13px}.g-node-n{font-size:11px;color:var(--muted)}
  .g-arrow{align-self:center;color:var(--muted);font-weight:700}
  .g-steps{list-style:none;margin:0;padding:0;display:grid;gap:10px;counter-reset:none}
  .g-step{display:grid;grid-template-columns:40px 1fr;gap:12px;border:1px solid var(--line);border-left:5px solid var(--c);
    border-radius:12px;padding:12px;background:var(--panel)}
  .g-step.done{opacity:.6}
  .g-step.done .g-num{background:#16a34a}
  .g-num{width:36px;height:36px;border-radius:50%;background:var(--c);color:#fff;font-weight:800;display:grid;place-items:center;font-size:16px}
  .g-body{display:grid;gap:7px;min-width:0}
  .g-head{display:flex;justify-content:space-between;gap:8px;align-items:center}
  .g-ph{font-size:12px;font-weight:600;color:var(--c)}
  .g-check{font-size:12px;color:var(--muted);display:flex;gap:5px;align-items:center;cursor:pointer;white-space:nowrap}
  .g-check input{width:16px;height:16px;accent-color:#16a34a}
  .g-title{font-weight:700;font-size:15px}
  .g-where{font-size:12px;display:flex;flex-wrap:wrap;gap:4px;align-items:center}
  .g-where span{background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:1px 7px}
  .g-where i{font-style:normal;color:var(--muted)}
  .g-open{font-weight:600;color:var(--c);text-decoration:none;margin-left:4px}
  .g-do{margin:0;padding-left:20px;display:grid;gap:3px;font-size:14px}
  .g-do code,.g-val code{background:var(--bg);padding:1px 6px;border-radius:5px;font-size:12.5px;overflow-wrap:anywhere}
  .g-copy{display:grid;gap:6px}
  .g-map{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:13px}
  .g-from{background:#1877F218;border:1px dashed #1877F2;border-radius:8px;padding:2px 9px;font-weight:600}
  .g-to-arrow{color:var(--muted);font-size:12px}
  .g-to{background:#e5322d18;border:1px dashed #e5322d;border-radius:8px;padding:2px 9px;font-weight:600}
  .g-val{display:flex;flex-wrap:wrap;gap:6px;align-items:center;background:var(--bg);border-radius:10px;padding:7px 10px;font-size:13px}
  .g-val-l{font-weight:600}.g-val code{flex:1;min-width:180px;background:none;padding:0}
  .g-cp{border:1px solid var(--line);background:var(--panel);border-radius:8px;padding:3px 10px;font-size:12px;cursor:pointer;color:inherit}
  .g-note{font-size:13px;border-radius:9px;padding:7px 10px}
  .g-note.ok{background:#16a34a18;border:1px solid #16a34a55}
  .g-note.tip{background:#1877F214;border:1px solid #1877F244}
  .g-note.warn{background:#d9770618;border:1px solid #d9770666}
  .g-trouble{border:1px solid var(--line);border-radius:12px;padding:10px 14px;background:var(--panel)}
  .g-trouble summary{cursor:pointer;font-weight:700}
  .g-trouble dl{margin:10px 0 0;display:grid;gap:8px}
  .g-trouble dt{font-weight:600;font-size:14px}
  .g-trouble dd{margin:0 0 0 14px;font-size:13px;color:var(--muted)}
  @media (max-width:560px){ .g-step{grid-template-columns:1fr} .g-num{width:30px;height:30px;font-size:14px} .g-flow{display:grid;grid-template-columns:1fr 1fr} .g-arrow{display:none} }
  @media print{ .g-check,.g-full,.g-cp,.g-open{display:none!important} .g-step{break-inside:avoid;opacity:1!important} .g-trouble{break-inside:avoid} }`;
  if (!document.getElementById("tesr-guide-css")) {
    const st = document.createElement("style"); st.id = "tesr-guide-css"; st.textContent = css; document.head.appendChild(st);
  }

  window.TESR_GUIDE = { render, has: (ch) => !!G[ch], channels: Object.keys(G) };
})();
