import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const ALLOWED_ORIGINS = ["https://iivestro.github.io"];
const GOVERNORATES = ["بغداد","نينوى","البصرة","النجف","كربلاء","بابل","القادسية","المثنى","ذي قار","ميسان","واسط","ديالى","صلاح الدين","كركوك","الأنبار","أربيل","السليمانية","دهوك","حلبجة"];

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") || "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (ALLOWED_ORIGINS.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function normalizeName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

function normalizePhone(value: string): string {
  let digits = value.replace(/\D/g, "");
  if (/^9647\d{9}$/.test(digits)) digits = "0" + digits.slice(3);
  return /^07\d{9}$/.test(digits) ? digits : "";
}

async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  const headers = cors(req);
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return reply({ error: "طريقة الطلب غير مدعومة." }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return reply({ error: "إعدادات تسجيل الدخول غير مكتملة." }, 500);

  const bodyText = await req.text();
  if (bodyText.length > 8192) return reply({ error: "الطلب أكبر من الحد المسموح." }, 413);

  let input: Record<string, unknown>;
  try {
    const parsed = JSON.parse(bodyText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return reply({ error: "الطلب غير صالح." }, 400);
    input = parsed as Record<string, unknown>;
  } catch {
    return reply({ error: "الطلب غير صالح." }, 400);
  }

  const mode = input.mode === "signup" ? "signup" : input.mode === "login" ? "login" : "";
  if (!mode) return reply({ error: "الطلب غير صالح." }, 400);

  const fullName = typeof input.full_name === "string" ? normalizeName(input.full_name) : "";
  const password = typeof input.password === "string" ? input.password : "";
  const phone = typeof input.phone === "string" ? normalizePhone(input.phone) : "";
  if (fullName.length < 2 || fullName.length > 150 || /[\u0000-\u001f]/.test(fullName) || password.length < 1 || password.length > 128) {
    return reply({ error: "تحقق من الاسم وكلمة المرور." }, 400);
  }
  if (mode === "signup" && password.length < 8) return reply({ error: "اجعل كلمة المرور 8 أحرف على الأقل." }, 400);
  if (mode === "signup" && !phone) return reply({ error: "أدخل رقم هاتف عراقي صحيحاً يبدأ بـ 07." }, 400);

  const clientIp = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || (req.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
  const ipHash = await digest("balsam-patient-auth:ip:" + clientIp);
  const nameHash = await digest("balsam-patient-auth:name:" + fullName.toLocaleLowerCase("ar"));

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const checkLimit = async (keyHash: string, limit: number) => {
    const { data, error } = await admin.rpc("consume_patient_auth_rate_limit", {
      p_key_hash: keyHash, p_limit: limit, p_window_seconds: 900,
    });
    if (error) throw new Error("rate_limit_unavailable");
    return data === true;
  };

  try {
    const ipAllowed = await checkLimit(ipHash, mode === "signup" ? 8 : 20);
    const nameAllowed = await checkLimit(nameHash, 8);
    if (!ipAllowed || !nameAllowed) return reply({ error: "محاولات كثيرة. حاول بعد 15 دقيقة." }, 429);
  } catch {
    return reply({ error: "تعذر التحقق من حد المحاولات. حاول لاحقاً." }, 503);
  }

  if (mode === "signup") {
    const age = Number(input.age);
    const governorate = typeof input.governorate === "string" ? input.governorate : "";
    if (!Number.isInteger(age) || age < 1 || age > 120 || !GOVERNORATES.includes(governorate)) {
      return reply({ error: "تحقق من العمر والمحافظة." }, 400);
    }

    const internalEmail = "patient-" + crypto.randomUUID() + "@accounts.balsam.invalid";
    const { data, error } = await admin.auth.admin.createUser({
      email: internalEmail,
      password,
      email_confirm: true,
      user_metadata: { account_type: "patient", full_name: fullName, phone, age: String(age), governorate },
    });
    if (error || !data.user) return reply({ error: "تعذر إنشاء الحساب. تحقق من البيانات وحاول مجدداً." }, 400);

    const { data: signedIn, error: signInError } = await anon.auth.signInWithPassword({ email: internalEmail, password });
    if (signInError || !signedIn.session) return reply({ error: "تم إنشاء الحساب. سجّل الدخول بالاسم وكلمة المرور." }, 200);
    return reply({ session: { access_token: signedIn.session.access_token, refresh_token: signedIn.session.refresh_token } });
  }

  const escapedName = fullName.replace(/[\\%_]/g, "\\$&");
  const { data: matches, error: lookupError } = await admin
    .from("profiles")
    .select("id,approval_status")
    .eq("role", "patient")
    .ilike("full_name", escapedName)
    .limit(21);

  if (lookupError) return reply({ error: "تعذر تسجيل الدخول حالياً." }, 503);
  if (!matches?.length || matches.length > 20) return reply({ error: "الاسم أو كلمة المرور غير صحيحة." }, 401);

  const valid: { session: { access_token: string; refresh_token: string }; status: string }[] = [];
  for (const profile of matches) {
    const { data: authUser } = await admin.auth.admin.getUserById(profile.id);
    const email = authUser.user?.email;
    if (!email) continue;
    const { data: signedIn } = await anon.auth.signInWithPassword({ email, password });
    if (signedIn.session) valid.push({
      session: { access_token: signedIn.session.access_token, refresh_token: signedIn.session.refresh_token },
      status: profile.approval_status,
    });
    if (valid.length > 1) break;
  }

  if (valid.length !== 1) return reply({ error: "الاسم أو كلمة المرور غير صحيحة." }, 401);
  if (valid[0].status !== "approved") return reply({ error: "هذا الحساب غير مفعّل. تواصل مع الدعم." }, 403);
  return reply({ session: valid[0].session });
});