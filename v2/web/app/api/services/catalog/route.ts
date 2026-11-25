import {authConfig,verifyUser} from '../../../../lib/auth';
export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function GET(request:Request){
 const token=/^Bearer ([A-Za-z0-9._-]{1,8192})$/.exec(request.headers.get('authorization')??'')?.[1];if(!token)return reply({error:'Unauthorized'},401);
 const config=authConfig();if(!config)return reply({error:'Unavailable'},503);
 const q=new URL(request.url).searchParams,section=q.get('section'),after=q.get('after');
 if(!['home_directory','home_requests','doctor_visits','admin_doctors','admin_centers','admin_reps'].includes(section??'')||(after&&!uuid.test(after)))return reply({error:'Invalid request'},400);
 try{
 const user=await verifyUser(token);if(!user)return reply({error:'Unauthorized'},401);
 const headers={apikey:config.key,Authorization:'Bearer '+token};
 const get=async(table:string,filters:Record<string,string>)=>{const u=new URL(config.url+'/rest/v1/'+table);for(const [k,v] of Object.entries(filters))u.searchParams.set(k,v);const r=await fetch(u,{headers,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('Unavailable');const rows=await r.json();if(!Array.isArray(rows))throw Error('Unavailable');return rows;};
 const role=section?.startsWith('home_')?'patient':section==='doctor_visits'?'doctor':'admin';
 const profile=await get('profiles',{select:'id',id:'eq.'+user.id,role:'eq.'+role,approval_status:'eq.approved',limit:'1'});if(profile[0]?.id!==user.id)return reply({error:'Forbidden'},403);
 const page={order:'id.asc',limit:'26',...(after?{id:'gt.'+after}:{})};
 let rows;
 if(section==='home_directory')rows=await get('rpc/home_service_directory',page);
 else if(section==='home_requests')rows=await get('home_service_requests',{...page,select:'id,status,quoted_price,scheduled_at,created_at',patient_id:'eq.'+user.id});
 else if(section==='doctor_visits'){
 const d=await get('doctors',{select:'id',profile_id:'eq.'+user.id,is_active:'eq.true',admin_is_active:'eq.true',subscription_expires_at:'gt.'+new Date().toISOString(),limit:'2'});if(d.length!==1||!uuid.test(d[0].id))return reply({error:'Forbidden'},403);
 rows=await get('rep_appointments',{...page,select:'id,status,created_at',doctor_id:'eq.'+d[0].id});
 }else if(section==='admin_doctors')rows=await get('doctors',{...page,select:'id,profile_id,is_active,admin_is_active,subscription_expires_at,subscription_fee,profile:profiles!doctors_profile_id_fkey(full_name)'});
 else if(section==='admin_centers')rows=await get('medical_centers',{...page,select:'id,name,is_active,subscription_expires_at,subscription_fee'});
 else {const repPage={order:'profile_id.asc',limit:'26',...(after?{profile_id:'gt.'+after}:{})};rows=(await get('rep_accounts',{...repPage,select:'profile_id,employer_type,employer_name,status,subscription_expires_at,subscription_fee'})).map(r=>({...r,id:r.profile_id}));}
 const items=rows.slice(0,25).map(r=>({...r,...(section==='admin_doctors'?{name:r.profile?.full_name??'طبيب'}:{})}));
 return reply({items,next:rows.length>25?items[24].id:null});
 }catch{return reply({error:'Unavailable'},503);}
}
