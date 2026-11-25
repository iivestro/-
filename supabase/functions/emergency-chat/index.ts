import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://iivestro.github.io",
  "Vary": "Origin",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function enforceRateLimit(
  admin: ReturnType<typeof createClient>,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const { data, error } = await admin.rpc("consume_emergency_chat_rate_limit", {
    p_key_hash: await sha256("emergency-chat:" + key),
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) throw new Error("تعذر التحقق من حد الطلبات.");
  return data === true;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey) return json({ error: "إعدادات الخادم غير مكتملة" }, 500);

    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const rawBody = await req.text();
    if (rawBody.length > 16384) return json({ error: "حجم الطلب أكبر من المسموح." }, 413);
    let body: Record<string, unknown>;
    try {
      const parsed = JSON.parse(rawBody);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return json({ error: "صيغة الطلب غير صحيحة." }, 400);
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return json({ error: "تعذر قراءة بيانات الطلب." }, 400);
    }
    const action = String(body.action || "");

    async function requireDoctor() {
      const authHeader = req.headers.get("Authorization") || "";
      if (!authHeader.toLowerCase().startsWith("bearer ")) {
        throw new Error("يجب تسجيل الدخول بحساب طبيب الطوارئ.");
      }
      const userClient = createClient(url!, anonKey!, {
        global: { headers: { Authorization: authHeader } },
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data: userData, error: userError } = await userClient.auth.getUser();
      if (userError || !userData.user) throw new Error("جلسة الدخول غير صالحة. سجّل الدخول مجدداً.");

      const doctorId = userData.user.id;
      const { data: profile, error: profileError } = await admin
        .from("profiles")
        .select("full_name, role, approval_status")
        .eq("id", doctorId)
        .maybeSingle();

      if (profileError || profile?.role !== "emergency_doctor" || profile?.approval_status !== "approved") {
        throw new Error("هذا الحساب غير مخوّل للدخول إلى محادثات الطوارئ.");
      }

      const { data: account, error: accountError } = await admin
        .from("emergency_doctor_accounts")
        .select("is_active")
        .eq("singleton", true)
        .eq("profile_id", doctorId)
        .maybeSingle();

      if (accountError || !account || account.is_active !== true) {
        throw new Error("حساب طبيب الطوارئ موقوف حالياً. راجع المدير.");
      }
      return { id: doctorId, name: profile.full_name || "طبيب الطوارئ" };
    }

    if (action === "create_chat") {
      const clientIp =
        req.headers.get("cf-connecting-ip") ||
        req.headers.get("x-real-ip") ||
        (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
        "unknown";
      if (!(await enforceRateLimit(admin, "create:" + clientIp, 4, 600))) {
        return json({ error: "تم تجاوز عدد محاولات فتح المحادثة. حاول بعد عدة دقائق." }, 429);
      }
      const name = String(body.name || "").trim().replace(/\s+/g, " ");
      if (name.length < 2 || name.length > 80) return json({ error: "اكتب اسمك بشكل صحيح (من حرفين إلى 80 حرفاً)." }, 400);

      const { data: account, error: accountError } = await admin
        .from("emergency_doctor_accounts")
        .select("is_active")
        .eq("singleton", true)
        .maybeSingle();

      if (accountError) return json({ error: "تعذر التحقق من توفر خدمة الطوارئ." }, 500);
      if (!account || account.is_active !== true) return json({ error: "خدمة محادثة الطوارئ غير متاحة حالياً." }, 503);

      const accessToken = crypto.randomUUID() + crypto.randomUUID();
      const tokenHash = await sha256(accessToken);
      const { data: created, error } = await admin.rpc("create_emergency_chat_limited", {
        p_visitor_name: name,
        p_access_token_hash: tokenHash,
        p_max_open: 5000,
      });
      const chat = Array.isArray(created) ? created[0] : null;

      if (error) return json({ error: "تعذر إنشاء المحادثة. حاول مرة أخرى." }, 500);
      if (!chat) return json({ error: "وصلت خدمة الطوارئ إلى الحد المؤقت للمحادثات المفتوحة." }, 503);
      return json({ chat, access_token: accessToken });
    }

    if (action === "visitor_get" || action === "visitor_send") {
      const chatId = String(body.chat_id || "");
      const token = String(body.access_token || "");
      if (!chatId || !token || token.length > 100) return json({ error: "بيانات المحادثة غير مكتملة." }, 400);

      const visitorKey = await sha256(token);
      const visitorLimit = action === "visitor_send" ? 20 : 30;
      if (!(await enforceRateLimit(admin, action + ":" + visitorKey, visitorLimit, 60))) {
        return json({ error: "طلبات كثيرة خلال وقت قصير. انتظر قليلاً ثم حاول مجدداً." }, 429);
      }

      const { data: chat, error: chatError } = await admin
        .from("emergency_chats")
        .select("id, visitor_name, status, access_token_hash, created_at")
        .eq("id", chatId)
        .maybeSingle();

      if (chatError || !chat || chat.access_token_hash !== await sha256(token)) {
        return json({ error: "رابط المحادثة غير صالح." }, 403);
      }
      if (chat.status !== "open") return json({ error: "هذه المحادثة مغلقة." }, 403);

      if (action === "visitor_send") {
        const message = String(body.message || "").trim();
        if (!message || message.length > 2000) return json({ error: "الرسالة مطلوبة ويجب ألا تتجاوز 2000 حرف." }, 400);

        const { error: insertError } = await admin.from("emergency_chat_messages").insert({
          chat_id: chatId,
          sender_type: "visitor",
          sender_name: chat.visitor_name,
          message,
        });
        if (insertError) return json({ error: "تعذر إرسال الرسالة." }, 500);
        await admin.from("emergency_chats").update({ updated_at: new Date().toISOString(), last_message_at: new Date().toISOString() }).eq("id", chatId);
        return json({ success: true });
      }

      const { data: messages, error: messagesError } = await admin
        .from("emergency_chat_messages")
        .select("id, sender_type, sender_name, message, created_at")
        .eq("chat_id", chatId)
        .order("created_at", { ascending: true })
        .limit(300);

      if (messagesError) return json({ error: "تعذر تحميل الرسائل." }, 500);
      return json({ chat: { id: chat.id, visitor_name: chat.visitor_name, status: chat.status, created_at: chat.created_at }, messages: messages || [] });
    }

    if (action === "doctor_list" || action === "doctor_get" || action === "doctor_send") {
      const doctor = await requireDoctor();
      const doctorLimit = action === "doctor_send" ? 20 : action === "doctor_list" ? 20 : 30;
      if (!(await enforceRateLimit(admin, "doctor:" + doctor.id + ":" + action, doctorLimit, 60))) {
        return json({ error: "طلبات كثيرة خلال وقت قصير. انتظر قليلاً ثم حاول مجدداً." }, 429);
      }

      if (action === "doctor_list") {
        const { data: chats, error } = await admin
          .from("emergency_chats")
          .select("id, visitor_name, status, created_at, last_message_at")
          .order("last_message_at", { ascending: false })
          .limit(200);
        if (error) return json({ error: "تعذر تحميل قائمة المحادثات." }, 500);
        return json({ chats: chats || [], doctor_name: doctor.name });
      }

      const chatId = String(body.chat_id || "");
      if (!chatId) return json({ error: "معرّف المحادثة غير موجود." }, 400);
      const { data: chat, error: chatError } = await admin
        .from("emergency_chats")
        .select("id, visitor_name, status, created_at")
        .eq("id", chatId)
        .maybeSingle();

      if (chatError || !chat) return json({ error: "المحادثة غير موجودة." }, 404);

      if (action === "doctor_send") {
        if (chat.status !== "open") return json({ error: "هذه المحادثة مغلقة." }, 403);
        const message = String(body.message || "").trim();
        if (!message || message.length > 2000) return json({ error: "الرسالة مطلوبة ويجب ألا تتجاوز 2000 حرف." }, 400);

        const { error: insertError } = await admin.from("emergency_chat_messages").insert({
          chat_id: chatId,
          sender_type: "doctor",
          sender_name: doctor.name,
          message,
        });
        if (insertError) return json({ error: "تعذر إرسال الرد." }, 500);
        const now = new Date().toISOString();
        await admin.from("emergency_chats").update({ updated_at: now, last_message_at: now }).eq("id", chatId);
        return json({ success: true });
      }

      const { data: messages, error: messagesError } = await admin
        .from("emergency_chat_messages")
        .select("id, sender_type, sender_name, message, created_at")
        .eq("chat_id", chatId)
        .order("created_at", { ascending: true })
        .limit(300);
      if (messagesError) return json({ error: "تعذر تحميل الرسائل." }, 500);
      return json({ chat, messages: messages || [] });
    }

    return json({ error: "الإجراء غير معروف." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message.includes("جلسة") || message.includes("مخوّل") || message.includes("موقوف") || message.includes("تسجيل الدخول") ? 401 : 500;
    return json({ error: status === 401 ? "تعذر التحقق من صلاحية الدخول." : "حدث خطأ غير متوقع. حاول لاحقاً." }, status);
  }
});
