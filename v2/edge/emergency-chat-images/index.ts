import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://iivestro.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "private, no-store", "X-Content-Type-Options":"nosniff" },
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

    // Hard gate until privacy, clinical safety, abuse and live integration reviews are complete.
    if (Deno.env.get("EMERGENCY_CHAT_IMAGES_READY") !== "enabled-after-validation") return json({error:"خدمة المحادثة قيد الاختبار."},503);
    const reader=req.body?.getReader();if(!reader)return json({error:"طلب غير صالح."},400);
    const decoder=new TextDecoder();let rawBody="",size=0;
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1420000){await reader.cancel();return json({error:"حجم الطلب أكبر من المسموح."},413);}rawBody+=decoder.decode(value,{stream:true});}
    rawBody+=decoder.decode();
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

    const bucket=admin.storage.from("emergency-private-images");
    function imageBytes(value:unknown):Uint8Array|null {
      if(typeof value!=="string"||value.length>1398104||!value.length||value.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(value))return null;
      try{const raw=atob(value);if(raw.length<4||raw.length>1048576)return null;
      const bytes=Uint8Array.from(raw,x=>x.charCodeAt(0));
      if(bytes[0]!==255||bytes[1]!==216||bytes[2]!==255||bytes[bytes.length-2]!==255||bytes[bytes.length-1]!==217)return null;
      return bytes;
      }catch{return null;}
    }
    async function sendImage(chatId:string,sender:"visitor"|"doctor",name:string){
      const image=imageBytes(body.image_base64);
      const message=typeof body.message==="string"?body.message.trim():"";
      if(!image||message.length>2000)return json({error:"صورة JPEG غير صالحة أو أكبر من 1 ميغابايت."},400);
      if(!(await enforceRateLimit(admin,"image:"+chatId,8,3600)))return json({error:"بلغت حد إرسال الصور لهذه المحادثة."},429);
      const id=crypto.randomUUID(),path=chatId+"/"+id+".jpg";
      const {error:uploadError}=await bucket.upload(path,image,{contentType:"image/jpeg",upsert:false,cacheControl:"0"});
      if(uploadError)return json({error:"تعذر رفع الصورة."},503);
      const {error:insertError}=await admin.from("emergency_chat_messages").insert({id,chat_id:chatId,sender_type:sender,sender_name:name,message:message||"صورة مرفقة",attachment_path:path});
      if(insertError){await bucket.remove([path]);return json({error:"تعذر حفظ الرسالة."},500);}
      const now=new Date().toISOString();await admin.from("emergency_chats").update({updated_at:now,last_message_at:now}).eq("id",chatId);
      return json({success:true});
    }
    async function getImage(chatId:string){
      const id=String(body.message_id||"");
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))return json({error:"معرف غير صالح."},400);
      const {data,error}=await admin.from("emergency_chat_messages").select("attachment_path").eq("id",id).eq("chat_id",chatId).maybeSingle();
      if(error||!data||data.attachment_path!==chatId+"/"+id+".jpg")return json({error:"الصورة غير متاحة."},404);
      const downloaded=await bucket.download(data.attachment_path);
      if(downloaded.error||!downloaded.data||downloaded.data.size>1048576)return json({error:"الصورة غير متاحة."},404);
      const bytes=new Uint8Array(await downloaded.data.arrayBuffer());
      let binary="";for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
      return json({image_base64:btoa(binary),mime:"image/jpeg"});
    }
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
      const { data: chat, error } = await admin
        .from("emergency_chats")
        .insert({ visitor_name: name, access_token_hash: tokenHash })
        .select("id, visitor_name, status, created_at")
        .single();

      if (error || !chat) return json({ error: "تعذر إنشاء المحادثة. حاول مرة أخرى." }, 500);
      return json({ chat, access_token: accessToken });
    }

    if (["visitor_get","visitor_send","visitor_image","visitor_send_image"].includes(action)) {
      const chatId = String(body.chat_id || "");
      const token = String(body.access_token || "");
      if (!chatId || !token || token.length > 100) return json({ error: "بيانات المحادثة غير مكتملة." }, 400);

      const visitorKey = await sha256(token);
      const visitorLimit = action === "visitor_send_image" ? 8 : action === "visitor_image" ? 12 : action === "visitor_send" ? 20 : 30;
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

      if(action==="visitor_image")return await getImage(chatId);
      if(action==="visitor_send_image")return await sendImage(chatId,"visitor",chat.visitor_name);
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
        .select("id, sender_type, sender_name, message, created_at, attachment_path")
        .eq("chat_id", chatId)
        .order("created_at", { ascending: true })
        .limit(300);

      if (messagesError) return json({ error: "تعذر تحميل الرسائل." }, 500);
      return json({ chat: { id: chat.id, visitor_name: chat.visitor_name, status: chat.status, created_at: chat.created_at }, messages: (messages || []).map(({attachment_path,...m})=>({...m,has_image:!!attachment_path})) });
    }

    if (["doctor_list","doctor_get","doctor_send","doctor_image","doctor_send_image"].includes(action)) {
      const doctor = await requireDoctor();
      const doctorLimit = action === "doctor_send_image" ? 8 : action === "doctor_image" ? 12 : action === "doctor_send" ? 20 : action === "doctor_list" ? 20 : 30;
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

      if(action==="doctor_image")return await getImage(chatId);
      if(action==="doctor_send_image"){if(chat.status!=="open")return json({error:"المحادثة مغلقة."},403);return await sendImage(chatId,"doctor",doctor.name);}
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
        .select("id, sender_type, sender_name, message, created_at, attachment_path")
        .eq("chat_id", chatId)
        .order("created_at", { ascending: true })
        .limit(300);
      if (messagesError) return json({ error: "تعذر تحميل الرسائل." }, 500);
      return json({ chat, messages: (messages || []).map(({attachment_path,...m})=>({...m,has_image:!!attachment_path})) });
    }

    return json({ error: "الإجراء غير معروف." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "حدث خطأ غير متوقع.";
    const status = message.includes("جلسة") || message.includes("مخوّل") || message.includes("موقوف") || message.includes("تسجيل الدخول") ? 401 : 500;
    return json({ error: status===401?message:"تعذر تنفيذ الطلب." }, status);
  }
});
