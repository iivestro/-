import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.2";

const ALLOWED_ORIGINS = ["https://iivestro.github.io"];

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") || "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (ALLOWED_ORIGINS.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function getSecretKey(): string {
  const secretKeysRaw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeysRaw) {
    try {
      const secretKeys = JSON.parse(secretKeysRaw);
      if (typeof secretKeys.default === "string" && secretKeys.default) {
        return secretKeys.default;
      }
    } catch {
      // Fall back to the legacy server-side secret below.
    }
  }
  return Deno.env.get("SERVICE_ROLE_KEY")
    || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    || "";
}

function getPublishableKey(): string {
  const publishableRaw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (publishableRaw) {
    try {
      const keys = JSON.parse(publishableRaw);
      if (typeof keys.default === "string" && keys.default) return keys.default;
    } catch {
      // Fall back to the legacy anon key below.
    }
  }
  return Deno.env.get("SUPABASE_ANON_KEY") || "";
}

Deno.serve(async (req: Request) => {
  const __requestOriginForSecurity = req.headers.get("Origin");
  if (__requestOriginForSecurity && __requestOriginForSecurity !== "https://iivestro.github.io") {
    return new Response(JSON.stringify({ error: "Origin not allowed" }), {
      status: 403,
      headers: { "Content-Type": "application/json", "Vary": "Origin" },
    });
  }
  const cors = corsHeaders(req);
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL") || "";
  const publishableKey = getPublishableKey();
  const secretKey = getSecretKey();

  if (!url || !publishableKey || !secretKey) {
    return reply({ error: "Server configuration is incomplete. Check Edge Function API key secrets." }, 500);
  }

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return reply({ error: "Authentication required" }, 401);

  const authClient = createClient(url, publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const adminClient = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user) return reply({ error: "Invalid session" }, 401);

  const { data: adminProfile, error: profileError } = await adminClient
    .from("profiles")
    .select("role,approval_status")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (profileError || adminProfile?.role !== "admin" || adminProfile?.approval_status !== "approved") {
    return reply({ error: "Administrator permission required" }, 403);
  }

  const { data: rateAllowed, error: rateError } = await adminClient.rpc(
    "consume_admin_create_doctor_rate_limit",
    { p_admin_id: authData.user.id },
  );
  if (rateError) return reply({ error: "Could not verify request limit" }, 500);
  if (rateAllowed !== true) {
    return reply({ error: "Too many medical-center creation requests. Try again later." }, 429);
  }

  const rawBody = await req.text();
  if (rawBody.length > 32768) return reply({ error: "Request body is too large" }, 413);

  let input: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return reply({ error: "Invalid JSON body" }, 400);
    }
    input = parsed as Record<string, unknown>;
  } catch {
    return reply({ error: "Invalid JSON body" }, 400);
  }

  const name = typeof input.name === "string" ? input.name.trim() : "";
  const phone = typeof input.phone === "string" ? input.phone.trim() : "";
  const city = typeof input.city === "string" ? input.city.trim() : "";
  const address = typeof input.address === "string" ? input.address.trim() : "";
  const mapsUrl = typeof input.maps_url === "string" ? input.maps_url.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const password = typeof input.password === "string" ? input.password : "";

  if (name.length < 2 || name.length > 180) return reply({ error: "اسم المركز غير صالح." }, 400);
  if (!city || city.length > 100) return reply({ error: "يرجى إدخال المحافظة بصورة صحيحة." }, 400);
  if (phone.length > 30 || address.length > 500) return reply({ error: "بيانات الهاتف أو العنوان طويلة أكثر من اللازم." }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply({ error: "البريد الإلكتروني غير صالح." }, 400);
  if (password.length < 10 || password.length > 128) return reply({ error: "كلمة المرور يجب أن تكون بين 10 و128 حرفاً." }, 400);

  if (mapsUrl) {
    try {
      const parsedUrl = new URL(mapsUrl);
      if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error("invalid protocol");
    } catch {
      return reply({ error: "رابط الخريطة يجب أن يبدأ بـ https:// أو http://." }, 400);
    }
  }

  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name },
  });

  if (createError || !created.user) {
    return reply({ error: "تعذر إنشاء حساب الدخول للمركز. تحقق من البريد ثم أعد المحاولة." }, 400);
  }

  const userId = created.user.id;

  const { error: insertProfileError } = await adminClient.from("profiles").upsert({
    id: userId,
    full_name: name,
    phone: phone || null,
    role: "medical_center",
    approval_status: "approved",
  }, { onConflict: "id" });

  if (insertProfileError) {
    await adminClient.auth.admin.deleteUser(userId);
    return reply({ error: "تعذر إنشاء ملف المركز. حاول لاحقاً." }, 500);
  }

  const { data: center, error: insertCenterError } = await adminClient
    .from("medical_centers")
    .insert({
      profile_id: userId,
      name,
      phone: phone || null,
      city,
      address: address || null,
      maps_url: mapsUrl || null,
      is_active: true,
      created_by: authData.user.id,
    })
    .select("id,name")
    .single();

  if (insertCenterError || !center) {
    await adminClient.from("profiles").delete().eq("id", userId);
    await adminClient.auth.admin.deleteUser(userId);
    return reply({ error: "تعذر حفظ بيانات المركز. حاول لاحقاً." }, 500);
  }

  return reply({
    success: true,
    center_id: center.id,
    name: center.name,
    email,
    message: "Medical center account created",
  }, 201);
});
