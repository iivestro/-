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

// Allowed browser origins. Add your custom domain here when you move off github.io.
const ALLOWED_ORIGINS = ["https://iivestro.github.io"];

function buildCors(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") || "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (ALLOWED_ORIGINS.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = buildCors(req);
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

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
      .select("role, approval_status")
      .eq("id", authData.user.id)
      .maybeSingle();

  if (
    profileError ||
    adminProfile?.role !== "admin" ||
    adminProfile?.approval_status !== "approved"
  ) {
    return reply({ error: "Administrator permission required" }, 403);
  }

  const { data: rateAllowed, error: rateError } = await adminClient.rpc(
    "consume_admin_create_doctor_rate_limit",
    { p_admin_id: authData.user.id },
  );
  if (rateError) {
    return reply({ error: "Could not verify request limit" }, 500);
  }
  if (rateAllowed !== true) {
    return reply({ error: "Too many doctor-creation requests. Try again later." }, 429);
  }

  let input: Record<string, unknown>;
  const rawBody = await req.text();
  if (rawBody.length > 32768) {
    return reply({ error: "Request body is too large" }, 413);
  }
  try {
    const parsed = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return reply({ error: "Invalid JSON body" }, 400);
    }
    input = parsed as Record<string, unknown>;
  } catch {
    return reply({ error: "Invalid JSON body" }, 400);
  }

  const fullName =
    typeof input.full_name === "string" ? input.full_name.trim() : "";
  const phone = typeof input.phone === "string" ? input.phone.trim() : "";
  const email =
    typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const password = typeof input.password === "string" ? input.password : "";
  const specialtyId =
    typeof input.specialty_id === "string" ? input.specialty_id.trim() : "";
  const specialtyName =
    typeof input.specialty_name === "string" ? input.specialty_name.trim() : "";
  const clinicId = typeof input.clinic_id === "string" ? input.clinic_id : "";
  const qualification =
    typeof input.qualification === "string" ? input.qualification.trim() : "";
  const bio = typeof input.bio === "string" ? input.bio.trim() : "";
  const experience = Number(input.experience_years ?? 0);
  const fee = Number(input.consultation_fee ?? 0);

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!fullName || fullName.length > 150) {
    return reply({ error: "Enter a valid doctor name" }, 400);
  }
  if (!phone || phone.length > 30) {
    return reply({ error: "Enter a valid phone number" }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return reply({ error: "Enter a valid email" }, 400);
  }
  if (password.length < 10) {
    return reply({ error: "Initial password must be at least 10 characters" }, 400);
  }
  if (specialtyName.length > 100 || (specialtyId && !uuidPattern.test(specialtyId)) || !uuidPattern.test(clinicId)) {
    return reply({ error: "Enter a specialty up to 100 characters and choose a valid clinic" }, 400);
  }
  if (!Number.isInteger(experience) || experience < 0 || experience > 70) {
    return reply({ error: "Invalid experience years" }, 400);
  }
  if (!Number.isFinite(fee) || fee < 0 || fee > 10000000) {
    return reply({ error: "Invalid consultation fee" }, 400);
  }

  const { data: clinic } = await adminClient
    .from("clinics").select("id").eq("id", clinicId).eq("is_active", true).maybeSingle();

  if (!clinic) {
    return reply({ error: "Selected clinic is unavailable" }, 400);
  }

  if (specialtyId) {
    const { data: specialty } = await adminClient
      .from("specialties").select("id").eq("id", specialtyId).eq("is_active", true).maybeSingle();
    if (!specialty) {
      return reply({ error: "Selected specialty is unavailable" }, 400);
    }
  }

  const { data: created, error: createError } =
    await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

  if (createError || !created.user) {
    return reply({ error: createError?.message || "Could not create auth user" }, 400);
  }

  const userId = created.user.id;

  const { error: insertProfileError } = await adminClient.from("profiles").upsert(
    {
      id: userId,
      full_name: fullName,
      phone,
      role: "doctor",
      approval_status: "approved",
    },
    { onConflict: "id" },
  );

  if (insertProfileError) {
    await adminClient.auth.admin.deleteUser(userId);
    return reply({ error: "Could not create doctor profile: " + insertProfileError.message }, 500);
  }

  let resolvedSpecialtyId: string | null = specialtyId || null;
  if (!resolvedSpecialtyId && specialtyName) {
    const { data: existingSpecialty, error: specialtyLookupError } = await adminClient
      .from("specialties")
      .select("id")
      .eq("name_ar", specialtyName)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    if (specialtyLookupError) {
      await adminClient.from("profiles").delete().eq("id", userId);
      await adminClient.auth.admin.deleteUser(userId);
      return reply({ error: "Could not check the specialty" }, 500);
    }
    if (existingSpecialty?.id) {
      resolvedSpecialtyId = existingSpecialty.id;
    } else {
      const { data: createdSpecialty, error: specialtyCreateError } = await adminClient
        .from("specialties")
        .insert({ name_ar: specialtyName, is_active: true })
        .select("id")
        .single();
      if (specialtyCreateError || !createdSpecialty?.id) {
        await adminClient.from("profiles").delete().eq("id", userId);
        await adminClient.auth.admin.deleteUser(userId);
        return reply({ error: "Could not save the specialty" }, 500);
      }
      resolvedSpecialtyId = createdSpecialty.id;
    }
  }

  const { error: insertDoctorError } = await adminClient.from("doctors").insert({
    profile_id: userId,
    specialty_id: resolvedSpecialtyId,
    clinic_id: clinicId,
    qualification: qualification || null,
    experience_years: experience,
    consultation_fee: fee,
    bio: bio || null,
    is_active: true,
  });

  if (insertDoctorError) {
    await adminClient.from("profiles").delete().eq("id", userId);
    await adminClient.auth.admin.deleteUser(userId);
    return reply({ error: "Could not create doctor record: " + insertDoctorError.message }, 500);
  }

  return reply({ success: true, doctor_id: userId, message: "Doctor account created" }, 201);
});
