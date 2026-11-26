import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.2";

const ALLOWED_ORIGIN = "https://iivestro.github.io";

function headers(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : "null",
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  };
}

function respond(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: headers(req) });
}

function readKeyMap(name: string): string {
  const raw = Deno.env.get(name);
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed?.default === "string" ? parsed.default : "";
  } catch {
    return "";
  }
}

function normalizeIraqiPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("07")) return digits;
  if (digits.length === 13 && digits.startsWith("9647")) return "0" + digits.slice(3);
  return "";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers(req) });
  if (req.method !== "POST") return respond(req, { error: "الطريقة غير مسموحة." }, 405);

  try {
    const authorization = req.headers.get("Authorization") || "";
    if (!authorization.toLowerCase().startsWith("bearer ")) return respond(req, { error: "سجّل الدخول أولاً." }, 401);

    const url = Deno.env.get("SUPABASE_URL") || "";
    const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") || readKeyMap("SUPABASE_PUBLISHABLE_KEYS");
    const secretKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || readKeyMap("SUPABASE_SECRET_KEYS");
    if (!url || !publishableKey || !secretKey) return respond(req, { error: "إعدادات الخادم غير مكتملة." }, 500);

    const userClient = createClient(url, publishableKey, {
      global: { headers: { Authorization: authorization } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const adminClient = createClient(url, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return respond(req, { error: "جلسة الدخول غير صالحة." }, 401);

    const { data: adminProfile, error: profileError } = await adminClient
      .from("profiles").select("role,approval_status").eq("id", userData.user.id).maybeSingle();
    if (profileError || adminProfile?.role !== "admin" || adminProfile?.approval_status !== "approved") {
      return respond(req, { error: "غير مصرح لك بإضافة مقدم خدمة." }, 403);
    }

    const { data: rateAllowed, error: rateError } = await adminClient.rpc(
      "consume_admin_create_doctor_rate_limit",
      { p_admin_id: userData.user.id },
    );
    if (rateError) return respond(req, { error: "تعذر التحقق من حد الطلبات." }, 503);
    if (rateAllowed !== true) return respond(req, { error: "طلبات كثيرة. حاول بعد قليل." }, 429);

    const rawBody = await req.text();
    if (rawBody.length > 16384) return respond(req, { error: "الطلب أكبر من الحد المسموح." }, 413);
    let body: Record<string, unknown>;
    try {
      const parsed = JSON.parse(rawBody);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return respond(req, { error: "البيانات غير صحيحة." }, 400);
      body = parsed as Record<string, unknown>;
    } catch {
      return respond(req, { error: "تعذر قراءة البيانات." }, 400);
    }

    const displayName = typeof body.display_name === "string" ? body.display_name.trim().replace(/\s+/g, " ") : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const phone = typeof body.phone === "string" ? normalizeIraqiPhone(body.phone) : "";
    const governorate = typeof body.governorate === "string" ? body.governorate.trim() : "";
    const rawKind = typeof body.kind === "string" ? body.kind : "";
    const kind = rawKind === "laboratory" ? "laboratory" : rawKind === "male" || rawKind === "female" ? "nurse" : "";
    const gender = rawKind === "male" || rawKind === "female" ? rawKind : null;

    if (displayName.length < 2 || displayName.length > 150) return respond(req, { error: "أدخل الاسم الكامل بشكل صحيح." }, 400);
    if (!phone) return respond(req, { error: "أدخل رقم هاتف عراقي صحيحاً يبدأ بـ 07." }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return respond(req, { error: "أدخل بريداً إلكترونياً صحيحاً لتسجيل الدخول." }, 400);
    if (password.length < 10 || password.length > 128) return respond(req, { error: "كلمة المرور يجب أن تكون بين 10 و128 حرفاً." }, 400);
    if (!governorate || governorate.length > 80) return respond(req, { error: "أدخل المحافظة بشكل صحيح." }, 400);
    if (!kind) return respond(req, { error: "اختر مختبراً أو ممرضاً أو ممرضة." }, 400);

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { account_type: "home_service_provider", full_name: displayName, phone, governorate },
    });
    if (createError || !created.user) {
      const duplicate = /already|registered|exists/i.test(createError?.message || "");
      return respond(req, { error: duplicate ? "هذا البريد مستخدم لحساب موجود." : "تعذر إنشاء حساب مقدم الخدمة." }, 400);
    }

    const { error: providerError } = await adminClient.from("home_service_providers").insert({
      account_id: created.user.id,
      display_name: displayName,
      phone,
      governorate,
      kind,
      gender,
      approved: false,
    });
    if (providerError) {
      await adminClient.auth.admin.deleteUser(created.user.id);
      return respond(req, { error: "تعذر حفظ بيانات مقدم الخدمة؛ لم يكتمل إنشاء الحساب." }, 500);
    }

    return respond(req, {
      success: true,
      message: "تم إنشاء حساب مقدم الخدمة وإرساله للمراجعة. يستخدم البريد وكلمة المرور المدخلين لتسجيل الدخول.",
    }, 201);
  } catch {
    return respond(req, { error: "حدث خطأ غير متوقع أثناء إنشاء الحساب." }, 500);
  }
});