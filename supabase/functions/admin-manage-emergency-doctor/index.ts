
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://iivestro.github.io",
  "Vary": "Origin",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  const __requestOriginForSecurity = req.headers.get("Origin");
  if (__requestOriginForSecurity && __requestOriginForSecurity !== "https://iivestro.github.io") {
    return new Response(JSON.stringify({ error: "Origin not allowed" }), {
      status: 403,
      headers: { "Content-Type": "application/json", "Vary": "Origin" },
    });
  }
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const respond = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    if (req.method !== "POST") {
      return respond({ error: "Method not allowed" }, 405);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return respond({ error: "يجب تسجيل الدخول أولاً" }, 401);
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SERVICE_ROLE_KEY");

    if (!url || !anonKey || !serviceKey) {
      return respond({ error: "إعدادات الخادم غير مكتملة" }, 500);
    }

    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const adminClient = createClient(url, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { data: userData, error: userError } =
      await userClient.auth.getUser();

    if (userError || !userData.user) {
      return respond({ error: "جلسة الدخول غير صالحة" }, 401);
    }

    const adminId = userData.user.id;

    const { data: adminProfile, error: profileError } =
      await adminClient
        .from("profiles")
        .select("role, approval_status")
        .eq("id", adminId)
        .single();

    if (
      profileError ||
      adminProfile?.role !== "admin" ||
      adminProfile?.approval_status !== "approved"
    ) {
      return respond({ error: "غير مصرح لك بتنفيذ هذا الإجراء" }, 403);
    }

    const body = await req.json();
    const action = body.action;

    if (action === "create") {
      const full_name = String(body.full_name || "").trim();
      const phone = String(body.phone || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");

      if (!full_name || !phone || !email || !password) {
        return respond({ error: "يرجى ملء جميع الحقول" }, 400);
      }

      if (password.length < 10) {
        return respond({ error: "كلمة المرور يجب أن تكون 10 أحرف على الأقل" }, 400);
      }

      const { data: existing } = await adminClient
        .from("emergency_doctor_accounts")
        .select("profile_id")
        .eq("singleton", true)
        .maybeSingle();

      if (existing) {
        return respond({
          error: "يوجد حساب طبيب طوارئ بالفعل. لا يمكن إنشاء حساب آخر.",
        }, 409);
      }

      const { data: created, error: createError } =
        await adminClient.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name, phone },
        });

      if (createError || !created.user) {
        return respond({
          error: createError?.message || "تعذر إنشاء الحساب",
        }, 400);
      }

      const doctorId = created.user.id;

      const { error: insertProfileError } = await adminClient
        .from("profiles")
        .upsert({
          id: doctorId,
          full_name,
          phone,
          role: "emergency_doctor",
          approval_status: "approved",
        });

      if (insertProfileError) {
        await adminClient.auth.admin.deleteUser(doctorId);
        return respond({ error: insertProfileError.message }, 500);
      }

      const { error: accountError } = await adminClient
        .from("emergency_doctor_accounts")
        .insert({
          singleton: true,
          profile_id: doctorId,
          is_active: true,
          created_by: adminId,
        });

      if (accountError) {
        await adminClient.from("profiles").delete().eq("id", doctorId);
        await adminClient.auth.admin.deleteUser(doctorId);
        return respond({ error: accountError.message }, 500);
      }

      return respond({
        success: true,
        message: "تم إنشاء حساب طبيب الطوارئ المستقل بنجاح",
        doctor_id: doctorId,
      });
    }

    if (action === "set_active") {
      if (typeof body.is_active !== "boolean") {
        return respond({ error: "حالة التفعيل غير صحيحة" }, 400);
      }

      const { data, error } = await adminClient
        .from("emergency_doctor_accounts")
        .update({
          is_active: body.is_active,
          updated_at: new Date().toISOString(),
        })
        .eq("singleton", true)
        .select("profile_id, is_active")
        .maybeSingle();

      if (error) {
        return respond({ error: error.message }, 500);
      }

      if (!data) {
        return respond({ error: "لا يوجد حساب طبيب طوارئ" }, 404);
      }

      return respond({
        success: true,
        is_active: data.is_active,
        message: data.is_active ? "تم تفعيل الحساب" : "تم إيقاف الحساب",
      });
    }

    return respond({ error: "الإجراء غير معروف" }, 400);
  } catch (error) {
    return respond({
      error: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
    }, 500);
  }
});
