import {authConfig,verifyUser,approvedPatient} from '../../../../lib/auth';
export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function POST(request:Request){
 const token=/^Bearer ([A-Za-z0-9._-]{1,8192})$/.exec(request.headers.get('authorization')??'')?.[1];
 if(!token)return reply({error:'Unauthorized'},401);
 const config=authConfig();if(!config||config.url!=='https://sfaatbfiwwbvobpvhwxo.supabase.co'||process.env.STAGING_BOOKING_WRITES!=='enabled-after-validation')return reply({error:'Unavailable'},503);
 if(!process.env.APP_ORIGIN||request.headers.get('origin')!==process.env.APP_ORIGIN)return reply({error:'Forbidden'},403);
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return reply({error:'Invalid request'},415);
 try{
 const reader=request.body?.getReader();if(!reader)return reply({error:'Invalid request'},400);
 const decoder=new TextDecoder();let raw='',bytes=0;
 for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>4096){await reader.cancel();return reply({error:'Invalid request'},413);}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();
 let b;try{b=JSON.parse(raw);}catch{return reply({error:'Invalid request'},400);}
 if(!b||typeof b!=='object'||!['doctor','center'].includes(b.kind)||typeof b.id!=='string'||!uuid.test(b.id)||!['confirm','reschedule','reject','complete','cancel'].includes(b.action))return reply({error:'Invalid request'},400);
 let at:string|null=null;
 if(['confirm','reschedule'].includes(b.action)){
 if(typeof b.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(b.date)||typeof b.time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.time))return reply({error:'Invalid time'},400);
 const check=new Date(b.date+'T00:00:00Z');if(!Number.isFinite(check.valueOf())||check.toISOString().slice(0,10)!==b.date)return reply({error:'Invalid date'},400);
 const future=new Date(b.date+'T'+b.time+':00+03:00');if(!Number.isFinite(future.valueOf())||future.valueOf()<=Date.now())return reply({error:'Invalid time'},400);
 at=future.toISOString();
 }
 const reason=typeof b.reason==='string'?b.reason.trim():null;if(b.action==='reject'&&(!reason||reason.length>1000))return reply({error:'Invalid reason'},400);
 const user=await verifyUser(token);if(!user)return reply({error:'Unauthorized'},401);if(!uuid.test(user.id))return reply({error:'Unavailable'},503);
 const read=async(table:string,query:Record<string,string>)=>{
 const u=new URL(config.url+'/rest/v1/'+table);for(const [k,v] of Object.entries(query))u.searchParams.set(k,v);
 const r=await fetch(u,{headers:{apikey:config.key,Authorization:'Bearer '+token},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});
 if(!r.ok)throw new Error('Unavailable');const rows=await r.json();if(!Array.isArray(rows))throw new Error('Unavailable');return rows;
 };
 const center=b.kind==='center';
 if(b.action==='cancel'){const p=await approvedPatient(token);if(p.status!==200)return reply({error:'Forbidden'},p.status);}
 const rows=await read(center?'center_appointments':'appointments',{select:center?'id,patient_id,center_id,status,appointment_at':'id,patient_id,doctor_id,status,appointment_at',id:'eq.'+b.id,limit:'1',...(b.action==='cancel'?{patient_id:'eq.'+user.id}:{})});
 const row=rows[0];if(row?.id!==b.id)return reply({error:'Not found'},404);
 if(b.action!=='cancel'){
 const role=center?'medical_center':'doctor';
 const p=await read('profiles',{select:'id',id:'eq.'+user.id,role:'eq.'+role,approval_status:'eq.approved',limit:'1'});if(p[0]?.id!==user.id)return reply({error:'Forbidden'},403);
 const providerId=center?row.center_id:row.doctor_id;if(typeof providerId!=='string'||!uuid.test(providerId))return reply({error:'Forbidden'},403);
 const provider=await read(center?'medical_centers':'doctors',{select:'id',id:'eq.'+providerId,profile_id:'eq.'+user.id,is_active:'eq.true',subscription_expires_at:'gt.'+new Date().toISOString(),limit:'1',...(center?{}:{admin_is_active:'eq.true'})});if(provider[0]?.id!==providerId)return reply({error:'Forbidden'},403);
 if(b.action==='complete'&&(!row.appointment_at||new Date(row.appointment_at).valueOf()>Date.now()))return reply({error:'Invalid time'},422);
 }
 const url=config.url+'/rest/v1/rpc/'+(center?'center_decide_appointment':'doctor_decide_appointment');
 const res=await fetch(url,{method:'POST',headers:{apikey:config.key,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({p_appointment_id:b.id,p_action:b.action,p_appointment_at:at,p_rejection_reason:b.action==='reject'?reason:null}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});
 if(!res.ok)return reply({error:'Decision not applied'},res.status===409?409:res.status>=500?503:422);
 const result=await res.json();if(result?.success!==true)return reply({error:'Unavailable'},503);
 return reply({status:result.status});
 }catch{return reply({error:'Unavailable'},503);}
}
