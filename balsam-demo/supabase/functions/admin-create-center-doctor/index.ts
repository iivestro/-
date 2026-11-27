
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.2";

function getSecretKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    if (typeof keys.default === "string" && keys.default) return keys.default;
  } catch {}
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
}
function getPublishableKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
    if (typeof keys.default === "string" && keys.default) return keys.default;
  } catch {}
  return Deno.env.get("SUPABASE_ANON_KEY") || "";
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://iivestro.github.io",
  "Vary": "Origin",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return reply({ error: "Method not allowed" }, 405);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = getPublishableKey();
  const serviceKey = getSecretKey();

  if (!url || !anonKey || !serviceKey) {
    return reply({ error: "Server configuration is incomplete" }, 500);
  }

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : "";

  if (!token) {
    return reply({ error: "Authentication required" }, 401);
  }

  const authClient = createClient(url, anonKey, {
    global: {
      headers: { Authorization: `Bearer ${token}` },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const adminClient = createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data: authData, error: authError } =
    await authClient.auth.getUser(token);

  if (authError || !authData.user) {
    return reply({ error: "Invalid session" }, 401);
  }

  const { data: adminProfile, error: profileError } =
    await adminClient
      .from("profiles")
      .select("role,approval_status")
      .eq("id", authData.user.id)
      .maybeSingle();

  if (
    profileError ||
    adminProfile?.role !== "admin" ||
    adminProfile?.approval_status !== "approved"
  ) {
    return reply({ error: "Administrator permission required" }, 403);
  }

  let input: Record<string, unknown>;

  try {
    input = await req.json();
  } catch {
    return reply({ error: "Invalid JSON body" }, 400);
  }

  const centerId = String(input.center_id || "");
  const fullName = String(input.full_name || "").trim();
  const phone = String(input.phone || "").trim();
  const specialty = String(input.specialty || "").trim();
  const qualification = String(input.qualification || "").trim();
  const bio = String(input.bio || "").trim();
  const email = String(input.email || "").trim().toLowerCase();
  const password = String(input.password || "");

  const experience = Number(input.experience_years ?? 0);
  const fee = Number(input.consultation_fee ?? 0);

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!uuidPattern.test(centerId)) {
    return reply({ error: "اختر مركزاً صحيحاً." }, 400);
  }

  if (!fullName || fullName.length > 180) {
    return reply({ error: "اسم الطبيب غير صحيح." }, 400);
  }

  if (!specialty || specialty.length > 150) {
    return reply({ error: "أدخل تخصص الطبيب." }, 400);
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return reply({ error: "البريد الإلكتروني غير صحيح." }, 400);
  }

  if (password.length < 10 || password.length > 128) {
    return reply({
      error: "كلمة المرور يجب أن تكون من 10 إلى 128 حرفاً.",
    }, 400);
  }

  if (
    !Number.isInteger(experience) ||
    experience < 0 ||
    experience > 70
  ) {
    return reply({ error: "سنوات الخبرة غير صحيحة." }, 400);
  }

  if (!Number.isFinite(fee) || fee < 0 || fee > 10000000) {
    return reply({ error: "أجرة الكشف غير صحيحة." }, 400);
  }

  const { data: center, error: centerError } =
    await adminClient
      .from("medical_centers")
      .select("id,name")
      .eq("id", centerId)
      .maybeSingle();

  if (centerError || !center) {
    return reply({ error: "المركز المحدد غير موجود." }, 404);
  }

  const { data: created, error: createError } =
    await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
      },
    });

  if (createError || !created.user) {
    return reply({
      error: createError?.message || "تعذر إنشاء الحساب.",
    }, 400);
  }

  const profileId = created.user.id;

  const { error: profileUpsertError } =
    await adminClient.from("profiles").upsert({
      id: profileId,
      full_name: fullName,
      phone: phone || null,
      role: "doctor",
      approval_status: "approved",
    }, {
      onConflict: "id",
    });

  if (profileUpsertError) {
    await adminClient.auth.admin.deleteUser(profileId);

    return reply({
      error: "تعذر إنشاء ملف الطبيب: " + profileUpsertError.message,
    }, 500);
  }

  const { data: doctor, error: doctorError } =
    await adminClient
      .from("center_doctors")
      .insert({
        profile_id: profileId,
        center_id: centerId,
        full_name: fullName,
        phone: phone || null,
        specialty,
        qualification: qualification || null,
        bio: bio || null,
        experience_years: experience,
        consultation_fee: fee,
        is_active: true,
      })
      .select("id")
      .single();

  if (doctorError || !doctor) {
    await adminClient.auth.admin.deleteUser(profileId);

    return reply({
      error: "تعذر ربط الطبيب بالمركز: " +
        (doctorError?.message || "خطأ غير معروف"),
    }, 500);
  }

  return reply({
    success: true,
    doctor_id: doctor.id,
    profile_id: profileId,
    message: "تم إنشاء حساب الطبيب وربطه بالمركز بنجاح.",
  }, 201);
});
