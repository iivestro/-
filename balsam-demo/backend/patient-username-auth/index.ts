import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.119.2";

const allowedOrigin = "https://iivestro.github.io";
const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
const governors = new Set([
  "بغداد", "نينوى", "البصرة", "النجف", "كربلاء", "بابل", "القادسية",
  "المثنى", "ذي قار", "ميسان", "واسط", "ديالى", "صلاح الدين", "كركوك",
  "الأنبار", "أربيل", "السليمانية", "دهوك", "حلبجة",
]);

function reply(status: number, body: Record<string, unknown>, origin: string | null) {
  const headers = new Headers({ ...corsHeaders, "Content-Type": "application/json; charset=utf-8" });
  if (origin !== allowedOrigin) headers.delete("Access-Control-Allow-Origin");
  return new Response(JSON.stringify(body), { status, headers });
}

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

function normalizeLoginName(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
  const length = Array.from(normalized).length;
  if (length < 3 || length > 120 || !/^[\p{L}\p{N}\p{M} ._'’-]+$/u.test(normalized)) return null;
  return normalized;
}

function internalEmail(usernameKey: string) {
  return sha256(usernameKey).then((digest) => `b${digest.slice(0, 40)}@accounts.balsam.invalid`);
}

function getSecretKey() {
  const rawKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (rawKeys) {
    try {
      const keys = JSON.parse(rawKeys) as Record<string, string>;
      const secret = keys.default ?? Object.values(keys)[0];
      if (secret) return secret;
    } catch {
      // Continue to the individual environment variables.
    }
  }
  return Deno.env.get("SUPABASE_SECRET_KEY")
    ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    ?? Deno.env.get("SERVICE_ROLE_KEY")
    ?? "";
}

const projectUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = getSecretKey();
const admin = createClient(projectUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function consumeLimit(bucket: string, limit: number) {
  const key = await sha256(bucket);
  const { data, error } = await admin.rpc("consume_balsam_auth_rate_limit", {
    p_key: key,
    p_limit: limit,
    p_window_seconds: 900,
  });
  if (error) throw new Error("rate limit service unavailable");
  return data === true;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    if (origin !== allowedOrigin) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (origin !== allowedOrigin) return reply(403, { error: "الطلب غير مسموح." }, origin);
  if (req.method !== "POST") return reply(405, { error: "الطريقة غير مسموحة." }, origin);
  if (!projectUrl || !serviceKey) return reply(503, { error: "الخدمة غير جاهزة حالياً." }, origin);

  try {
    const body = await req.json();
    const action = body?.action;
    const usernameKey = normalizeLoginName(body?.username);
    if (!usernameKey || !["signup", "lookup"].includes(action)) {
      return reply(400, { error: "أدخل الاسم الكامل والبيانات بشكل صحيح." }, origin);
    }

    const ip = req.headers.get("cf-connecting-ip")
      ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      ?? "unknown";
    const userAgent = (req.headers.get("user-agent") ?? "unknown").slice(0, 120);
    const ipBucket = ip === "unknown" ? `ua:${userAgent}` : `ip:${ip}`;
    const ipLimit = action === "signup" ? 6 : 40;
    const usernameLimit = action === "signup" ? 3 : 10;
    if (!await consumeLimit(`${action}:${ipBucket}`, ipLimit)
      || !await consumeLimit(`${action}:username:${usernameKey}`, usernameLimit)) {
      return reply(429, { error: "محاولات كثيرة. انتظر قليلاً ثم أعد المحاولة." }, origin);
    }

    const { data: mappedAccount, error: lookupError } = await admin
      .from("patient_login_accounts")
      .select("login_email")
      .eq("username_key", usernameKey)
      .maybeSingle();
    if (lookupError) return reply(503, { error: "تعذر الاتصال بخدمة الحسابات." }, origin);

    if (action === "lookup") {
      return reply(200, {
        login_email: mappedAccount?.login_email ?? await internalEmail(usernameKey),
      }, origin);
    }

    const fullName = typeof body?.full_name === "string" ? body.full_name.trim() : "";
    const age = Number(body?.age);
    const governorate = typeof body?.governorate === "string" ? body.governorate : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (mappedAccount) {
      return reply(409, { error: "هذا الاسم مستخدم. أضف اسم الأب أو الجد إلى الاسم الكامل." }, origin);
    }
    if (normalizeLoginName(fullName) !== usernameKey
      || Array.from(fullName).length < 3 || fullName.length > 120
      || !Number.isInteger(age) || age < 1 || age > 120
      || !governors.has(governorate)
      || password.length < 10 || password.length > 72) {
      return reply(400, { error: "أكمل البيانات، واجعل الاسم 3 أحرف وكلمة المرور 10 أحرف على الأقل." }, origin);
    }

    const loginEmail = await internalEmail(usernameKey);
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: loginEmail,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        account_type: "patient",
        age,
        governorate,
      },
    });
    if (createError || !created.user) {
      return reply(409, { error: "تعذر إنشاء الحساب. تحقق من الاسم الكامل وحاول مجدداً." }, origin);
    }

    const userId = created.user.id;
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .update({
        full_name: fullName,
        phone: null,
        role: "patient",
        approval_status: "approved",
        age,
        governorate,
      })
      .eq("id", userId)
      .select("id")
      .maybeSingle();
    if (profileError || !profile) {
      await admin.auth.admin.deleteUser(userId);
      return reply(503, { error: "تعذر تجهيز الحساب. حاول مرة أخرى." }, origin);
    }

    const { error: mapError } = await admin.from("patient_login_accounts").insert({
      user_id: userId,
      username: fullName,
      username_key: usernameKey,
      login_email: loginEmail,
    });
    if (mapError) {
      await admin.auth.admin.deleteUser(userId);
      return reply(409, { error: "هذا الاسم مستخدم. أضف اسم الأب أو الجد إلى الاسم الكامل." }, origin);
    }

    return reply(201, { login_email: loginEmail }, origin);
  } catch {
    return reply(503, { error: "تعذر تنفيذ الطلب حالياً." }, origin);
  }
});
