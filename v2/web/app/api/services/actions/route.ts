import {authConfig,verifyUser} from '../../../../lib/auth';
export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId=(v:unknown):v is string=>typeof v==='string'&&uuid.test(v);
const clock=(v:unknown):v is string=>typeof v==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(v);
export async function POST(request:Request){
 const token=/^Bearer ([A-Za-z0-9._-]{1,8192})$/.exec(request.headers.get('authorization')??'')?.[1];
 if(!token)return reply({error:'Unauthorized'},401);
 const config=authConfig();if(!config)return reply({error:'Unavailable'},503);
 try{
 const user=await verifyUser(token);if(!user)return reply({error:'Unauthorized'},401);
 const headers={apikey:config.key,Authorization:'Bearer '+token,'Content-Type':'application/json'};
 const read=async(table:string,query:Record<string,string>)=>{
 const u=new URL(config.url+'/rest/v1/'+table);for(const [k,v] of Object.entries(query))u.searchParams.set(k,v);
 const r=await fetch(u,{headers,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('Unavailable');const rows=await r.json();if(!Array.isArray(rows))throw Error('Unavailable');return rows;
 };
 if(!process.env.APP_ORIGIN||request.headers.get('origin')!==process.env.APP_ORIGIN)return reply({error:'Forbidden'},403);
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return reply({error:'Invalid request'},415);
 const reader=request.body?.getReader();if(!reader)return reply({error:'Invalid request'},400);
 let raw='',bytes=0;const decoder=new TextDecoder();for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>4096){await reader.cancel();return reply({error:'Invalid request'},413);}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();
 let b;try{b=JSON.parse(raw);}catch{return reply({error:'Invalid request'},400);}
 if(!b||typeof b!=='object'||Array.isArray(b)||typeof b.action!=='string')return reply({error:'Invalid request'},400);
 const roleByAction:Record<string,string>={schedule_save:'doctor',visit_book:'representative',visit_decide:'doctor',home_book:'patient',home_progress:'home_provider',renew_clinical:'admin',renew_rep:'admin'};
 const role=Object.hasOwn(roleByAction,b.action)?roleByAction[b.action]:null;if(!role)return reply({error:'Invalid action'},400);
 const now=new Date().toISOString();let providerId:string|undefined;
 if(role==='home_provider'){
 const rows=await read('home_service_providers',{select:'id',account_id:'eq.'+user.id,approved:'eq.true',subscription_expires_at:'gt.'+now,limit:'2'});if(rows.length!==1||!isId(rows[0].id))return reply({error:'Forbidden'},403);providerId=rows[0].id;
 }else{
 const p=await read('profiles',{select:'id',id:'eq.'+user.id,role:'eq.'+role,approval_status:'eq.approved',limit:'1'});if(p[0]?.id!==user.id)return reply({error:'Forbidden'},403);
 if(role==='doctor'){const d=await read('doctors',{select:'id',profile_id:'eq.'+user.id,is_active:'eq.true',admin_is_active:'eq.true',subscription_expires_at:'gt.'+now,limit:'2'});if(d.length!==1||!isId(d[0].id))return reply({error:'Forbidden'},403);providerId=d[0].id;}
 if(role==='representative'){const r=await read('rep_accounts',{select:'profile_id',profile_id:'eq.'+user.id,status:'eq.approved',subscription_expires_at:'gt.'+now,limit:'1'});if(r[0]?.profile_id!==user.id)return reply({error:'Forbidden'},403);}
 }
 if(config.url!=='https://sfaatbfiwwbvobpvhwxo.supabase.co'||process.env.STAGING_SERVICE_WRITES!=='enabled-after-validation')return reply({error:'Writes disabled'},503);
 let rpc='',args:Record<string,unknown>={};
 switch(b.action){
 case 'schedule_save':{
 if(!isId(b.id)||!Number.isInteger(b.day)||b.day<0||b.day>6||!clock(b.start)||!clock(b.end)||b.start>=b.end||typeof b.available!=='boolean'||typeof b.unlimited!=='boolean'||(!b.unlimited&&(!Number.isInteger(b.max)||b.max<1||b.max>1000)))return reply({error:'Invalid schedule'},400);
 const u=new URL(config.url+'/rest/v1/doctor_schedules');u.searchParams.set('id','eq.'+b.id);u.searchParams.set('doctor_id','eq.'+providerId);u.searchParams.set('select','id');
 const r=await fetch(u,{method:'PATCH',headers:{...headers,Prefer:'return=representation'},body:JSON.stringify({day_of_week:b.day,start_time:b.start,end_time:b.end,is_available:b.available,unlimited_daily:b.unlimited,max_daily_patients:b.unlimited?null:b.max}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});
 if(!r.ok)return reply({error:'Action failed'},r.status>=500?503:422);const data=await r.json();return data?.length===1&&data[0].id===b.id?reply({ok:true}):reply({error:'Not found'},404);
 }
 case 'visit_book':if(!isId(b.id))return reply({error:'Invalid slot'},400);
 {const slots=await read('rep_visit_slots',{select:'doctor_id',id:'eq.'+b.id,is_open:'eq.true',limit:'1'});if(!isId(slots[0]?.doctor_id))return reply({error:'Not found'},404);const d=await read('doctors',{select:'id',id:'eq.'+slots[0].doctor_id,is_active:'eq.true',admin_is_active:'eq.true',subscription_expires_at:'gt.'+now,limit:'1'});if(d[0]?.id!==slots[0].doctor_id)return reply({error:'Unavailable slot'},422);}
 rpc='book_rep_visit';args={p_slot_id:b.id,p_notes:null};break;
 case 'visit_decide':if(!isId(b.id)||!['approved','rejected','completed'].includes(b.status))return reply({error:'Invalid decision'},400);
 rpc='doctor_update_rep_appointment';args={p_appointment_id:b.id,p_new_status:b.status};break;
 case 'home_book':if(!isId(b.id)||typeof b.description!=='string'||!b.description.trim()||b.description.length>1000)return reply({error:'Invalid request'},400);rpc='home_service_book';args={p_provider:b.id,p_description:b.description.trim()};break;
 case 'home_progress':if(!isId(b.id)||!['quoted','en_route','arrived','completed'].includes(b.status))return reply({error:'Invalid status'},400);
 {const rows=await read('home_service_requests',{select:'id',id:'eq.'+b.id,provider_id:'eq.'+providerId,limit:'1'});if(rows[0]?.id!==b.id)return reply({error:'Not found'},404);}
 if(b.status==='quoted'&&(!Number.isInteger(b.price)||b.price<0||b.price>100000000||typeof b.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(b.date)||!clock(b.time)||!Number.isFinite(Date.parse(b.date+'T'+b.time+':00+03:00'))||Date.parse(b.date+'T'+b.time+':00+03:00')<=Date.now()))return reply({error:'Invalid quote'},400);
 rpc='home_service_progress';args={p_request:b.id,p_status:b.status,p_price:b.status==='quoted'?b.price:null,p_time:b.status==='quoted'?b.date+'T'+b.time+':00+03:00':null};break;
 case 'renew_clinical':if(!isId(b.id)||!['doctor','medical_center'].includes(b.kind))return reply({error:'Invalid provider'},400);rpc='admin_renew_clinical_subscription';args={p_kind:b.kind,p_id:b.id};break;
 case 'renew_rep':if(!isId(b.id))return reply({error:'Invalid account'},400);rpc='admin_renew_representative_subscription';args={p_profile_id:b.id};break;
 default:return reply({error:'Invalid action'},400);
 }
 const r=await fetch(config.url+'/rest/v1/rpc/'+rpc,{method:'POST',headers,body:JSON.stringify(args),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});
 if(!r.ok)return reply({error:'Action failed'},r.status>=500?503:422);
 return reply({ok:true});
 }catch{return reply({error:'Unavailable'},503);}
}
