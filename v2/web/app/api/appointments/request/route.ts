import {recordOperationalEvent} from '../../../../lib/monitoring';
import {randomUUID} from 'node:crypto';
import {authConfig,approvedPatient} from '../../../../lib/auth';
export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function POST(request:Request){
 const token=/^Bearer ([A-Za-z0-9._-]{1,8192})$/.exec(request.headers.get('authorization')??'')?.[1];
 if(!token)return reply({error:'Unauthorized'},401);
 const config=authConfig();
 // Keep writes disabled until database constraints and concurrency tests pass.
 if(!config||config.url!=='https://sfaatbfiwwbvobpvhwxo.supabase.co'||process.env.STAGING_BOOKING_WRITES!=='enabled-after-validation')return reply({error:'Unavailable'},503);
 if(!process.env.APP_ORIGIN||request.headers.get('origin')!==process.env.APP_ORIGIN)return reply({error:'Forbidden'},403);
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return reply({error:'Invalid request'},415);
 try{
 const reader=request.body?.getReader();if(!reader)return reply({error:'Invalid request'},400);
 let bytes=0,raw='';const decoder=new TextDecoder();
 for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>4096){await reader.cancel();return reply({error:'Invalid request'},413);}raw+=decoder.decode(value,{stream:true});}
 raw+=decoder.decode();let body;try{body=JSON.parse(raw);}catch{return reply({error:'Invalid request'},400);}
 if(!body||typeof body!=='object'||!['doctor','center'].includes(body.kind)||typeof body.providerId!=='string'||!uuid.test(body.providerId)||typeof body.requestId!=='string'||!uuid.test(body.requestId)||typeof body.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(body.date)||(body.kind==='center'&&(typeof body.centerId!=='string'||!uuid.test(body.centerId))))return reply({error:'Invalid request'},400);
 const date=new Date(body.date+'T00:00:00Z');if(!Number.isFinite(date.valueOf())||date.toISOString().slice(0,10)!==body.date)return reply({error:'Invalid date'},400);
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Baghdad',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 if(body.date<today)return reply({error:'Invalid date'},400);
 const user=await approvedPatient(token);if(user.status!==200)return reply({error:user.status===403?'Forbidden':user.status===401?'Unauthorized':'Unavailable'},user.status);
 const center=body.kind==='center';
 const row={id:body.requestId,patient_id:user.id,status:'pending',requested_date:body.date,appointment_at:null,...(center?{center_id:body.centerId,center_doctor_id:body.providerId}:{doctor_id:body.providerId})};
 const url=new URL(config.url+'/rest/v1/'+(center?'center_appointments':'appointments'));
 const res=await fetch(url,{method:'POST',headers:{apikey:config.key,Authorization:'Bearer '+token,'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify(row),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});
 if(res.ok)return reply({id:body.requestId,status:'pending'},201);
 if(res.status===409)return reply({error:'Booking conflict'},409);
 if(res.status===400||res.status===422)return reply({error:'Booking unavailable'},422);
 return reply({error:'Unavailable'},503);
 }catch{await recordOperationalEvent('booking');return reply({error:'Unavailable'},503);}
}

export async function GET(request:Request){
 const token=/^Bearer ([A-Za-z0-9._-]{1,8192})$/.exec(request.headers.get('authorization')??'')?.[1];
 if(!token)return reply({error:'Unauthorized'},401);
 const config=authConfig();if(!config)return reply({error:'Unavailable'},503);
 try{const user=await approvedPatient(token);if(user.status!==200)return reply({error:'Unavailable'},user.status);
 return reply({requestId:randomUUID(),writesEnabled:config.url==='https://sfaatbfiwwbvobpvhwxo.supabase.co'&&process.env.STAGING_BOOKING_WRITES==='enabled-after-validation'});
 }catch{await recordOperationalEvent('booking');return reply({error:'Unavailable'},503);}
}
