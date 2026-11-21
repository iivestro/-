
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return reply({ error: "Method not allowed" }, 405);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SERVICE_ROLE_KEY");

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

  let input: Record<string, unknown>;

  try {
    input = await req.json();
  } catch {
    return reply({ error: "Invalid JSON body" }, 400);
  }

  const fullName =
    typeof input.full_name === "string"
      ? input.full_name.trim()
      : "";

  const phone =
    typeof input.phone === "string"
      ? input.phone.trim()
      : "";

  const email =
    typeof input.email === "string"
      ? input.email.trim().toLowerCase()
      : "";

  const password =
    typeof input.password === "string"
      ? input.password
      : "";

  const specialtyId =
    typeof input.specialty_id === "string"
      ? input.specialty_id
      : "";

  const clinicId =
    typeof input.clinic_id === "string"
      ? input.clinic_id
      : "";

  const qualification =
    typeof input.qualification === "string"
      ? input.qualification.trim()
      : "";

  const bio =
    typeof input.bio === "string"
      ? input.bio.trim()
      : "";

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
    return reply({
      error: "Initial password must be at least 10 characters",
    }, 400);
  }

  if (!uuidPattern.test(specialtyId) || !uuidPattern.test(clinicId)) {
    return reply({
      error: "Choose a valid specialty and clinic",
    }, 400);
  }

  if (
    !Number.isInteger(experience) ||
    experience < 0 ||
    experience > 70
  ) {
    return reply({ error: "Invalid experience years" }, 400);
  }

  if (
    !Number.isFinite(fee) ||
    fee < 0 ||
    fee > 10000000
  ) {
    return reply({ error: "Invalid consultation fee" }, 400);
  }

  const [{ data: specialty }, { data: clinic }] =
    await Promise.all([
      adminClient
        .from("specialties")
        .select("id")
        .eq("id", specialtyId)
        .eq("is_active", true)
        .maybeSingle(),

      adminClient
        .from("clinics")
        .select("id")
        .eq("id", clinicId)
        .eq("is_active", true)
        .maybeSingle(),
    ]);

  if (!specialty || !clinic) {
    return reply({
      error: "Selected specialty or clinic is unavailable",
    }, 400);
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
      error: createError?.message || "Could not create auth user",
    }, 400);
  }

  const userId = created.user.id;

  const { error: insertProfileError } =
    await adminClient.from("profiles").insert({
      id: userId,
      full_name: fullName,
      phone,
      role: "doctor",
      approval_status: "approved",
    });

  if (insertProfileError) {
    await adminClient.auth.admin.deleteUser(userId);

    return reply({
      error:
        "Could not create doctor profile: " +
        insertProfileError.message,
    }, 500);
  }

  const { error: insertDoctorError } =
    await adminClient.from("doctors").insert({
      profile_id: userId,
      specialty_id: specialtyId,
      clinic_id: clinicId,
      qualification: qualification || null,
      experience_years: experience,
      consultation_fee: fee,
      bio: bio || null,
      is_active: true,
    });

  if (insertDoctorError) {
    await adminClient
      .from("profiles")
      .delete()
      .eq("id", userId);

    await adminClient.auth.admin.deleteUser(userId);

    return reply({
      error:
        "Could not create doctor record: " +
        insertDoctorError.message,
    }, 500);
  }

  return reply({
    success: true,
    doctor_id: userId,
    message: "Doctor account created",
  }, 201);
});
