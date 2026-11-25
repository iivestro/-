import {recordOperationalEvent} from '../../../lib/monitoring';
import {authConfig,verifyUser} from '../../../lib/auth';
export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const objectPath=/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(pdf|jpg|png)$/i;
export async function POST(request:Request){
 const cfg=authConfig(),origin=process.env.APP_ORIGIN;
 if(!cfg||cfg.url!=='https://sfaatbfiwwbvobpvhwxo.supabase.co'||!origin||process.env.STAGING_HEALTH_DOCUMENTS!=='enabled-after-validation')return reply({error:'Disabled'},503);
 if(request.headers.get('origin')!==origin)return reply({error:'Forbidden'},403);
 const token=/^Bearer ([A-Za-z0-9._-]{1,8192})$/.exec(request.headers.get('authorization')??'')?.[1];if(!token)return reply({error:'Unauthorized'},401);
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return reply({error:'Invalid request'},415);
 try{
 if(!await verifyUser(token))return reply({error:'Unauthorized'},401);
 const reader=request.body?.getReader();if(!reader)return reply({error:'Invalid request'},400);
 let raw='',size=0;const decoder=new TextDecoder();for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>7000000){await reader.cancel();return reply({error:'Too large'},413);}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();
 let b;try{b=JSON.parse(raw);}catch{return reply({error:'Invalid request'},400);}
 if(!b||typeof b!=='object'||Array.isArray(b)||!['upload','list','shared_list','share','revoke','download'].includes(b.action))return reply({error:'Invalid request'},400);
 const auth={apikey:cfg.key,Authorization:'Bearer '+token};
 async function rpc(action:string,data:object={}){
 const r=await fetch(cfg!.url+'/rest/v1/rpc/v2_health_document_action',{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify({p_action:action,p_data:data}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('Denied');return r.json();
 }
 if(b.action==='list'||b.action==='shared_list')return reply({result:await rpc(b.action)});
 if(b.action==='upload'){
 if(typeof b.item_id!=='string'||!uuid.test(b.item_id)||!['application/pdf','image/jpeg','image/png'].includes(b.mime_type)||typeof b.base64!=='string'||b.base64.length>6990508||b.base64.length%4||!/^[A-Za-z0-9+/]+={0,2}$/.test(b.base64))return reply({error:'Invalid file'},400);
 const bytes=Buffer.from(b.base64,'base64');
 if(bytes.length<8||bytes.length>5242880)return reply({error:'Invalid size'},400);
 const magic=b.mime_type==='application/pdf'?bytes.subarray(0,5).toString()==='%PDF-':b.mime_type==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 if(!magic)return reply({error:'Invalid format'},400);
 const reserve=await rpc('reserve',{item_id:b.item_id,mime_type:b.mime_type});
 if(!objectPath.test(reserve.object_path)||!uuid.test(reserve.id))throw Error('Invalid reservation');
 const res=await fetch(cfg.url+'/storage/v1/object/patient-private-health/'+reserve.object_path,{method:'POST',headers:{...auth,'Content-Type':b.mime_type,'x-upsert':'false','Cache-Control':'0'},body:new Uint8Array(bytes),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!res.ok){await recordOperationalEvent('storage','storage_error');return reply({error:'Upload failed'},503);}
 return reply({result:{id:reserve.id,scan_state:'pending'}},202);
 }
 if(typeof b.id!=='string'||!uuid.test(b.id))return reply({error:'Invalid document'},400);
 if(b.action==='share'||b.action==='revoke'){
 if(typeof b.doctor_profile_id!=='string'||!uuid.test(b.doctor_profile_id)||b.action==='share'&&b.consent!==true)return reply({error:'Invalid consent'},400);
 return reply({result:await rpc(b.action,{id:b.id,doctor_profile_id:b.doctor_profile_id,consent:b.consent===true})});
 }
 const allowed=await rpc('authorize_read',{id:b.id});if(allowed.authorized!==true||!objectPath.test(allowed.object_path))return reply({error:'Forbidden'},403);
 const res=await fetch(cfg.url+'/storage/v1/object/authenticated/patient-private-health/'+allowed.object_path,{headers:auth,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!res.ok)return reply({error:'Unavailable'},503);
 const buffer=Buffer.from(await res.arrayBuffer());if(buffer.length>5242880)return reply({error:'Unavailable'},503);
 return reply({result:{base64:buffer.toString('base64'),mime_type:allowed.mime_type}});
 }catch{return reply({error:'Document unavailable or not authorized'},403);}
}
