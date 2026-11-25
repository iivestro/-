import {authConfig,verifyUser} from '../../../../lib/auth';
export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function POST(request:Request){
 const token=/^Bearer ([A-Za-z0-9._-]{1,8192})$/.exec(request.headers.get('authorization')??'')?.[1];if(!token)return reply({error:'Unauthorized'},401);
 const cfg=authConfig();if(!cfg)return reply({error:'Unavailable'},503);
 try{
 const user=await verifyUser(token);if(!user||!uuid.test(user.id))return reply({error:'Unauthorized'},401);
 if(!process.env.APP_ORIGIN||request.headers.get('origin')!==process.env.APP_ORIGIN)return reply({error:'Forbidden'},403);
 if(cfg.url!=='https://sfaatbfiwwbvobpvhwxo.supabase.co'||process.env.STAGING_NOTIFICATION_WRITES!=='enabled-after-validation')return reply({error:'Writes disabled'},503);
 if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return reply({error:'Invalid request'},415);
 const reader=request.body?.getReader();if(!reader)return reply({error:'Invalid request'},400);
 const dec=new TextDecoder();let raw='',bytes=0;for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>512){await reader.cancel();return reply({error:'Invalid request'},413);}raw+=dec.decode(value,{stream:true});}raw+=dec.decode();
 let data;try{data=JSON.parse(raw);}catch{return reply({error:'Invalid request'},400);}
 if(!data||typeof data.id!=='string'||!uuid.test(data.id))return reply({error:'Invalid request'},400);
 const u=new URL(cfg.url+'/rest/v1/notifications');u.searchParams.set('id','eq.'+data.id);u.searchParams.set('user_id','eq.'+user.id);u.searchParams.set('select','id,is_read');
 const res=await fetch(u,{method:'PATCH',headers:{apikey:cfg.key,Authorization:'Bearer '+token,'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify({is_read:true}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});
 if(!res.ok)return reply({error:'Unavailable'},res.status>=500?503:422);
 const rows=await res.json();if(rows?.length!==1||rows[0].id!==data.id||rows[0].is_read!==true)return reply({error:'Not found'},404);
 return reply({id:data.id,is_read:true});
 }catch{return reply({error:'Unavailable'},503);}
}
