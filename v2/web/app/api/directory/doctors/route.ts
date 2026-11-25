import {authConfig,approvedPatient} from '../../../../lib/auth';
export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(request:Request){
 const token=/^Bearer ([A-Za-z0-9._-]{1,8192})$/.exec(request.headers.get('authorization')??'')?.[1];
 if(!token)return reply({error:'Unauthorized'},401);
 const config=authConfig();if(!config)return reply({error:'Unavailable'},503);
 const cursor=new URL(request.url).searchParams.get('after');
 if(cursor&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor))return reply({error:'Invalid cursor'},400);
 try{
  const access=await approvedPatient(token);
  if(access.status!==200)return reply({error:access.status===403?'Forbidden':access.status===401?'Unauthorized':'Unavailable'},access.status);
  const url=new URL(config.url+'/rest/v1/doctors');
  url.searchParams.set('select','id,specialty_id,qualification,experience_years,consultation_fee,profile:profiles!doctors_profile_id_fkey!inner(full_name,role,approval_status),specialty:specialties!doctors_specialty_id_fkey(name_ar)');
  url.searchParams.set('is_active','eq.true');url.searchParams.set('admin_is_active','eq.true');
  url.searchParams.set('subscription_expires_at','gt.'+new Date().toISOString());
  url.searchParams.set('profile.role','eq.doctor');url.searchParams.set('profile.approval_status','eq.approved');
  url.searchParams.set('order','id.asc');url.searchParams.set('limit','26');
  if(cursor)url.searchParams.set('id','gt.'+cursor);
  const result=await fetch(url,{headers:{apikey:config.key,Authorization:'Bearer '+token},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});
  if(!result.ok)return reply({error:'Unavailable'},503);
  const rows:unknown=await result.json();if(!Array.isArray(rows))return reply({error:'Unavailable'},503);
  const items=rows.slice(0,25).map(({id,specialty_id,qualification,experience_years,consultation_fee,profile,specialty})=>({id,specialty_id,qualification,experience_years,consultation_fee,name:profile?.full_name??null,specialty:specialty?.name_ar??null}));
  return reply({items,next:rows.length>25?items[24].id:null});
 }catch{return reply({error:'Unavailable'},503);}
}
