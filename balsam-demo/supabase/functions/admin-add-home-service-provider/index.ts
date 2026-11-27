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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers(req) });
  if (req.method !== "POST") return respond(req, { error: "الطريقة غير مسموحة." }, 405);

  try {
    const authorization = req.headers.get("Authorization");
    if (!authorization) return respond(req, { error: "سجّل الدخول أولاً." }, 401);

    const url = Deno.env.get("SUPABASE_URL") || "";
    const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") || readKeyMap("SUPABASE_PUBLISHABLE_KEYS");
    const secretKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || readKeyMap("SUPABASE_SECRET_KEYS");
    if (!url || !publishableKey || !secretKey) {
      return respond(req, { error: "إعدادات الخادم غير مكتملة." }, 500);
    }

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

    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return respond(req, { error: "البيانات غير صحيحة." }, 400);
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return respond(req, { error: "تعذر قراءة البيانات." }, 400);
    }

    const displayName = String(body.display_name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const governorate = String(body.governorate || "").trim();
    const rawKind = String(body.kind || "");
    const kind = rawKind === "laboratory" ? "laboratory" : rawKind === "nurse" ? "nurse" : "";
    const gender = body.gender === "male" || body.gender === "female" ? body.gender : null;

    if (!displayName || displayName.length > 150 || !governorate || governorate.length > 80) {
      return respond(req, { error: "أدخل الاسم والمحافظة بشكل صحيح." }, 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return respond(req, { error: "أدخل بريداً إلكترونياً صحيحاً." }, 400);
    }
    if (password.length < 10 || password.length > 128) {
      return respond(req, { error: "كلمة المرور يجب أن تكون بين 10 و128 حرفاً." }, 400);
    }
    if (!kind || (kind === "nurse" && !gender) || (kind === "laboratory" && gender)) {
      return respond(req, { error: "نوع الخدمة غير صحيح." }, 400);
    }

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: displayName },
    });
    if (createError || !created.user) {
      const msg = createError?.message || "";
      const duplicate = /already|registered|exists/i.test(msg);
      return respond(req, { error: duplicate ? "هذا البريد مستخدم لحساب موجود." : "تعذر إنشاء حساب الدخول." }, 400);
    }

    const { error: providerError } = await adminClient.from("home_service_providers").insert({
      account_id: created.user.id,
      display_name: displayName,
      governorate,
      kind,
      gender,
      approved: false,
    });
    if (providerError) {
      await adminClient.auth.admin.deleteUser(created.user.id);
      return respond(req, { error: "تعذر ربط حساب مقدم الخدمة؛ لم يتم إكمال إنشاء الحساب." }, 500);
    }

    return respond(req, { success: true, message: "تم إنشاء حساب مقدم الخدمة وإرساله للمراجعة." }, 201);
  } catch {
    return respond(req, { error: "حدث خطأ غير متوقع أثناء إنشاء الحساب." }, 500);
  }
});
