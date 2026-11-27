import {createClient} from "npm:@supabase/supabase-js@2.49.4";
Deno.serve(async req=>{
const headers={"Content-Type":"application/json","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
const reply=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers});
try{
const token=req.headers.get("Authorization");if(!token?.startsWith("Bearer "))return reply(401,{error:"unauthorized"});
const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_ANON_KEY")!,{global:{headers:{Authorization:token}},auth:{persistSession:false,autoRefreshToken:false}});
const {data:{user},error}=await db.auth.getUser();if(error||!user)return reply(401,{error:"unauthorized"});
if(req.method!=="GET")return reply(405,{error:"method_not_allowed"});
const limit=await db.rpc("patient_api_rate_check");if(limit.error)return reply(503,{error:"service_unavailable"});if(limit.data!==true)return new Response(JSON.stringify({error:"rate_limit_exceeded"}),{status:429,headers:{...headers,"Retry-After":"60"}});const url=new URL(req.url);const path=url.pathname.split("/").filter(Boolean).pop();
if(path==="health"||path==="patient-api-v1")return reply(200,{service:"PATIENT",version:"1",status:"ok"});
const {data:p,error:pe}=await db.from("profiles").select("role,approval_status").eq("id",user.id).maybeSingle();
if(pe||p?.role!=="patient"||p.approval_status!=="approved")return reply(403,{error:"forbidden"});
const page=Number(url.searchParams.get("page")??0);if(!Number.isInteger(page)||page<0||page>10000)return reply(400,{error:"invalid_page"});
const from=page*25;
let result;
switch(path){
case "appointments":result=await db.from("appointments").select("id,doctor_id,appointment_at,status,requested_date,created_at").eq("patient_id",user.id).order("created_at",{ascending:false}).order("id").range(from,from+24);break;
case "center-appointments":result=await db.from("center_appointments").select("id,center_id,center_doctor_id,appointment_at,status,requested_date,created_at").eq("patient_id",user.id).order("created_at",{ascending:false}).order("id").range(from,from+24);break;
case "home-requests":result=await db.from("home_service_requests").select("id,provider_id,status,quoted_price,scheduled_at,created_at").eq("patient_id",user.id).order("created_at",{ascending:false}).order("id").range(from,from+24);break;
default:return reply(404,{error:"not_found"});
}
if(result.error)return reply(503,{error:"service_unavailable"});
return reply(200,{data:result.data,page,page_size:25});
}catch{return reply(503,{error:"service_unavailable"});}
});