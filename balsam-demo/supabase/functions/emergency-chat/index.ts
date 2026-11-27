import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.2";

const originAllowed = "https://iivestro.github.io";
const BUCKET = "emergency-chat-attachments";
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MARKER = "[[BALSAM_IMG:";

function headers(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": origin === originAllowed ? originAllowed : "null",
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  };
}

function json(req: Request, data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: headers(req) });
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function enforceRateLimit(admin: any, key: string, limit: number, seconds: number): Promise<boolean> {
  const { data, error } = await admin.rpc("consume_emergency_chat_rate_limit", {
    p_key_hash: await sha256("emergency-chat:" + key),
    p_limit: limit,
    p_window_seconds: seconds,
  });
  if (error) throw new Error("rate_limit");
  return data === true;
}

async function decodeImage(admin: any, chatId: string, raw: unknown) {
  if (!raw || typeof raw !== "object") return null;
  const attachment = raw as Record<string, unknown>;
  const mime = String(attachment.mime_type || "");
  const base64 = String(attachment.base64 || "");
  if (mime !== "image/jpeg" && mime !== "image/png") throw new Error("image_type");
  if (!base64 || base64.length > 2_800_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error("image_size");
  let bytes: Uint8Array;
  try {
    const binary = atob(base64);
    bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  } catch {
    throw new Error("image_invalid");
  }
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error("image_size");
  const jpeg = mime === "image/jpeg" && bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const png = mime === "image/png" && bytes.length >= 8 &&
    bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 &&
    bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10;
  if (!jpeg && !png) throw new Error("image_invalid");
  const ext = jpeg ? "jpg" : "png";
  const path = chatId + "/" + crypto.randomUUID() + "." + ext;
  const { error } = await admin.storage.from(BUCKET).upload(path, bytes, {
    contentType: mime,
    upsert: false,
    cacheControl: "60",
  });
  if (error) throw new Error("image_upload");
  return path;
}

function splitMessage(raw: string, chatId: string) {
  const match = raw.match(/\n?\[\[BALSAM_IMG:([0-9a-f-]+\/[0-9a-f-]+\.(?:jpg|png))\]\]$/i);
  if (!match || !match[1].startsWith(chatId + "/")) return { text: raw, path: null as string | null };
  return { text: raw.slice(0, match.index).trim(), path: match[1] };
}

async function decorateMessages(admin: any, rows: any[], chatId: string) {
  return await Promise.all(rows.map(async (row) => {
    const parsed = splitMessage(String(row.message || ""), chatId);
    let attachment_url: string | null = null;
    if (parsed.path) {
      const { data } = await admin.storage.from(BUCKET).createSignedUrl(parsed.path, 300);
      attachment_url = data?.signedUrl || null;
    }
    return { ...row, message: parsed.text, attachment_url };
  }));
}

async function saveMessage(admin: any, chatId: string, senderType: "visitor" | "doctor", senderName: string, body: Record<string, unknown>) {
  const text = String(body.message || "").trim();
  if (text.length > 2000) throw new Error("message_size");
  const path = await decodeImage(admin, chatId, body.attachment);
  if (!text && !path) throw new Error("message_required");
  const message = (text || "صورة مرفقة") + (path ? "\n" + MARKER + path + "]]" : "");
  const { error } = await admin.from("emergency_chat_messages").insert({
    chat_id: chatId,
    sender_type: senderType,
    sender_name: senderName,
    message,
  });
  if (error) {
    if (path) await admin.storage.from(BUCKET).remove([path]);
    throw new Error("message_save");
  }
  const now = new Date().toISOString();
  await admin.from("emergency_chats").update({ updated_at: now, last_message_at: now }).eq("id", chatId);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: headers(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
  const origin = req.headers.get("origin") || "";
  if (origin && origin !== originAllowed) return json(req, { error: "غير مسموح لهذا المصدر." }, 403);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    let anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    let serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
    try {
      if (!anonKey) {
        const raw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
        if (raw) anonKey = JSON.parse(raw).default || "";
      }
    } catch { /* fall through to the clear configuration error below */ }
    try {
      if (!serviceKey) {
        const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
        if (raw) serviceKey = JSON.parse(raw).default || "";
      }
    } catch { /* fall through to the clear configuration error below */ }
    if (!url || !anonKey || !serviceKey) return json(req, { error: "إعدادات الخدمة غير مكتملة." }, 500);
    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

    const rawBody = await req.text();
    if (rawBody.length > 3_100_000) return json(req, { error: "حجم الطلب أكبر من المسموح." }, 413);
    let body: Record<string, unknown>;
    try {
      const parsed = JSON.parse(rawBody);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json(req, { error: "صيغة الطلب غير صحيحة." }, 400);
      body = parsed as Record<string, unknown>;
    } catch {
      return json(req, { error: "تعذر قراءة بيانات الطلب." }, 400);
    }
    const action = String(body.action || "");

    async function requireDoctor() {
      const authHeader = req.headers.get("Authorization") || "";
      if (!authHeader.toLowerCase().startsWith("bearer ")) throw new Error("unauthorized");
      const userClient = createClient(url!, anonKey!, {
        global: { headers: { Authorization: authHeader } },
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data, error } = await userClient.auth.getUser();
      if (error || !data.user) throw new Error("unauthorized");
      const doctorId = data.user.id;
      const { data: profile } = await admin.from("profiles").select("full_name,role,approval_status").eq("id", doctorId).maybeSingle();
      if (profile?.role !== "emergency_doctor" || profile?.approval_status !== "approved") throw new Error("unauthorized");
      const { data: account } = await admin.from("emergency_doctor_accounts").select("is_active").eq("singleton", true).eq("profile_id", doctorId).maybeSingle();
      if (!account || account.is_active !== true) throw new Error("unauthorized");
      return { id: doctorId, name: profile.full_name || "طبيب الطوارئ" };
    }

    if (action === "create_chat") {
      const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") ||
        (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
      if (!(await enforceRateLimit(admin, "create:" + ip, 4, 600))) return json(req, { error: "تم تجاوز عدد محاولات فتح المحادثة. حاول بعد عدة دقائق." }, 429);
      const name = String(body.name || "").trim().replace(/\s+/g, " ");
      if (name.length < 2 || name.length > 80) return json(req, { error: "اكتب الاسم من حرفين إلى 80 حرفاً." }, 400);
      const { data: account, error: accountError } = await admin.from("emergency_doctor_accounts").select("is_active").eq("singleton", true).maybeSingle();
      if (accountError) return json(req, { error: "تعذر التحقق من توفر الخدمة." }, 500);
      if (!account || account.is_active !== true) return json(req, { error: "محادثة طبيب الطوارئ غير متاحة حالياً." }, 503);
      const token = crypto.randomUUID() + crypto.randomUUID();
      const tokenHash = await sha256(token);
      const { data: created, error } = await admin.rpc("create_emergency_chat_limited", {
        p_visitor_name: name, p_access_token_hash: tokenHash, p_max_open: 5000,
      });
      const chat = Array.isArray(created) ? created[0] : null;
      if (error || !chat) return json(req, { error: "تعذر إنشاء المحادثة الآن. حاول لاحقاً." }, error ? 500 : 503);
      return json(req, { chat, access_token: token });
    }

    if (action === "visitor_get" || action === "visitor_send") {
      const chatId = String(body.chat_id || "");
      const token = String(body.access_token || "");
      if (!chatId || !token || token.length > 100) return json(req, { error: "بيانات المحادثة غير مكتملة." }, 400);
      const tokenHash = await sha256(token);
      if (!(await enforceRateLimit(admin, action + ":" + tokenHash, action === "visitor_send" ? 20 : 30, 60))) {
        return json(req, { error: "طلبات كثيرة خلال وقت قصير. انتظر قليلاً ثم حاول." }, 429);
      }
      const { data: chat } = await admin.from("emergency_chats")
        .select("id,visitor_name,status,access_token_hash").eq("id", chatId).maybeSingle();
      if (!chat || chat.access_token_hash !== tokenHash) return json(req, { error: "بيانات المحادثة غير صالحة." }, 403);
      if (chat.status !== "open") return json(req, { error: "هذه المحادثة مغلقة." }, 403);
      if (action === "visitor_send") {
        try {
          await saveMessage(admin, chatId, "visitor", chat.visitor_name, body);
        } catch (error) {
          const reason = error instanceof Error ? error.message : "";
          if (reason === "image_type") return json(req, { error: "ارفع صورة بصيغة PNG أو JPG." }, 415);
          if (reason === "image_size") return json(req, { error: "حجم الصورة يجب ألا يتجاوز 2 ميغابايت." }, 413);
          if (reason === "image_invalid") return json(req, { error: "ملف الصورة غير صالح." }, 400);
          if (reason === "message_size") return json(req, { error: "الرسالة لا تتجاوز 2000 حرف." }, 400);
          if (reason === "message_required") return json(req, { error: "اكتب رسالة أو أرفق صورة." }, 400);
          return json(req, { error: "تعذر إرسال الرسالة أو الصورة. حاول لاحقاً." }, 500);
        }
        return json(req, { success: true });
      }
      const { data: rows, error } = await admin.from("emergency_chat_messages")
        .select("id,sender_type,sender_name,message,created_at").eq("chat_id", chatId)
        .order("created_at", { ascending: true }).limit(300);
      if (error) return json(req, { error: "تعذر تحميل الرسائل." }, 500);
      return json(req, { chat: { id: chat.id, visitor_name: chat.visitor_name, status: chat.status }, messages: await decorateMessages(admin, rows || [], chatId) });
    }

    if (action === "doctor_list" || action === "doctor_get" || action === "doctor_send" || action === "doctor_close") {
      const doctor = await requireDoctor();
      if (!(await enforceRateLimit(admin, "doctor:" + doctor.id + ":" + action, action === "doctor_send" ? 20 : 30, 60))) {
        return json(req, { error: "طلبات كثيرة خلال وقت قصير. انتظر قليلاً ثم حاول." }, 429);
      }
      if (action === "doctor_list") {
        const { data: chats, error } = await admin.from("emergency_chats")
          .select("id,visitor_name,status,created_at,last_message_at")
          .order("last_message_at", { ascending: false }).limit(200);
        if (error) return json(req, { error: "تعذر تحميل المحادثات." }, 500);
        return json(req, { chats: chats || [], doctor_name: doctor.name });
      }
      const chatId = String(body.chat_id || "");
      if (!chatId) return json(req, { error: "المحادثة غير محددة." }, 400);
      const { data: chat, error: chatError } = await admin.from("emergency_chats")
        .select("id,visitor_name,status,created_at").eq("id", chatId).maybeSingle();
      if (chatError || !chat) return json(req, { error: "المحادثة غير موجودة." }, 404);
      if (action === "doctor_close") {
        if (chat.status === "open") {
          const now = new Date().toISOString();
          const { error: closeError } = await admin.from("emergency_chats")
            .update({ status: "closed", updated_at: now, last_message_at: now })
            .eq("id", chatId).eq("status", "open");
          if (closeError) return json(req, { error: "تعذر إنهاء المحادثة." }, 500);
        }
        const { data: rows, error: rowsError } = await admin.from("emergency_chat_messages")
          .select("id,message").eq("chat_id", chatId);
        if (rowsError) return json(req, { error: "تعذر تجهيز حذف رسائل المحادثة." }, 500);
        const paths = [...new Set((rows || []).map(row => splitMessage(String(row.message || ""), chatId).path).filter(Boolean))] as string[];
        if (paths.length) {
          const { error: storageError } = await admin.storage.from(BUCKET).remove(paths);
          if (storageError) return json(req, { error: "أُغلقت المحادثة، لكن تعذر حذف صورها. أعد المحاولة." }, 500);
        }
        const { error: messagesDeleteError } = await admin.from("emergency_chat_messages").delete().eq("chat_id", chatId);
        if (messagesDeleteError) return json(req, { error: "تعذر حذف رسائل المحادثة. أعد المحاولة." }, 500);
        const { error: chatDeleteError } = await admin.from("emergency_chats").delete().eq("id", chatId);
        if (chatDeleteError) return json(req, { error: "تعذر حذف سجل المحادثة. أعد المحاولة." }, 500);
        return json(req, { success: true, message: "تم إنهاء المحادثة وحذف رسائلها وصورها." });
      }
      if (action === "doctor_send") {
        if (chat.status !== "open") return json(req, { error: "هذه المحادثة مغلقة." }, 403);
        try {
          await saveMessage(admin, chatId, "doctor", doctor.name, body);
        } catch (error) {
          const reason = error instanceof Error ? error.message : "";
          if (reason === "image_type") return json(req, { error: "ارفع صورة بصيغة PNG أو JPG." }, 415);
          if (reason === "image_size") return json(req, { error: "حجم الصورة يجب ألا يتجاوز 2 ميغابايت." }, 413);
          if (reason === "image_invalid") return json(req, { error: "ملف الصورة غير صالح." }, 400);
          if (reason === "message_size") return json(req, { error: "الرسالة لا تتجاوز 2000 حرف." }, 400);
          if (reason === "message_required") return json(req, { error: "اكتب رداً أو أرفق صورة." }, 400);
          return json(req, { error: "تعذر إرسال الرد أو الصورة. حاول لاحقاً." }, 500);
        }
        return json(req, { success: true });
      }
      const { data: rows, error } = await admin.from("emergency_chat_messages")
        .select("id,sender_type,sender_name,message,created_at").eq("chat_id", chatId)
        .order("created_at", { ascending: true }).limit(300);
      if (error) return json(req, { error: "تعذر تحميل الرسائل." }, 500);
      return json(req, { chat, messages: await decorateMessages(admin, rows || [], chatId) });
    }

    return json(req, { error: "الإجراء غير معروف." }, 400);
  } catch {
    return json(req, { error: "حدث خطأ غير متوقع. حاول لاحقاً." }, 500);
  }
});
