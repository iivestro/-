import {authConfig,verifyUser} from '../../../../lib/auth';
export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const roles=['patient','doctor','medical_center','representative','emergency_doctor','admin'];
const statuses=['pending','approved','rejected','suspended'];
async function access(request:Request){
 const token=/^Bearer ([A-Za-z0-9._-]{1,8192})$/.exec(request.headers.get('authorization')??'')?.[1];
 if(!token)return {status:401 as const};
 const config=authConfig();if(!config)return {status:503 as const};
 const user=await verifyUser(token);if(!user||!uuid.test(user.id))return {status:401 as const};
 const headers={apikey:config.key,Authorization:'Bearer '+token};
 const url=new URL(config.url+'/rest/v1/profiles');
 url.searchParams.set('select','id');url.searchParams.set('id','eq.'+user.id);url.searchParams.set('role','eq.admin');url.searchParams.set('approval_status','eq.approved');url.searchParams.set('limit','1');
 const result=await fetch(url,{headers,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});
 if(!result.ok)return {status:503 as const};const items=await result.json();
 if(items?.[0]?.id!==user.id)return {status:403 as const};
 return {status:200 as const,config,headers,user};
}
export async function GET(request:Request){
 try{
 const a=await access(request);if(a.status!==200)return reply({error:'Access denied'},a.status);
 const p=new URL(request.url).searchParams,role=p.get('role'),status=p.get('status'),after=p.get('after');
 if((role&&!roles.includes(role))||(status&&!statuses.includes(status))||(after&&!uuid.test(after)))return reply({error:'Invalid filter'},400);
 const u=new URL(a.config.url+'/rest/v1/profiles');
 const query={select:'id,full_name,role,approval_status,created_at',order:'id.asc',limit:'26',...(role?{role:'eq.'+role}:{}),...(status?{approval_status:'eq.'+status}:{}),...(after?{id:'gt.'+after}:{})};
 for(const [k,v] of Object.entries(query))u.searchParams.set(k,v);
 const r=await fetch(u,{headers:a.headers,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});
 if(!r.ok)return reply({error:'Unavailable'},503);const data=await r.json();
 if(!Array.isArray(data))return reply({error:'Unavailable'},503);const items=data.slice(0,25);
 return reply({items,next:data.length>25?items[24].id:null});
 }catch{return reply({error:'Unavailable'},503);}
}
export async function POST(request:Request){
 try{
 const a=await access(request);if(a.status!==200)return reply({error:'Access denied'},a.status);
 if(a.config.url!=='https://sfaatbfiwwbvobpvhwxo.supabase.co'||process.env.STAGING_ADMIN_WRITES!=='enabled-after-validation')return reply({error:'Writes disabled'},503);
 if(!process.env.APP_ORIGIN||request.headers.get('origin')!==process.env.APP_ORIGIN)return reply({error:'Forbidden'},403);
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return reply({error:'Invalid request'},415);
 const reader=request.body?.getReader();if(!reader)return reply({error:'Invalid request'},400);
 const decoder=new TextDecoder();let raw='',bytes=0;for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>4096){await reader.cancel();return reply({error:'Invalid request'},413);}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();
 let b;try{b=JSON.parse(raw);}catch{return reply({error:'Invalid request'},400);}
 if(!b||typeof b.id!=='string'||!uuid.test(b.id)||b.id===a.user.id||!['patient','representative'].includes(b.role)||!['approved','rejected','suspended'].includes(b.status))return reply({error:'Invalid action'},400);
 const headers={...a.headers,'Content-Type':'application/json'};
 if(b.role==='representative'){
 const r=await fetch(a.config.url+'/rest/v1/rpc/admin_set_representative_status',{method:'POST',headers,body:JSON.stringify({p_profile_id:b.id,p_status:b.status}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});
 if(!r.ok)return reply({error:'Action failed'},r.status>=500?503:422);if(await r.json()!==true)return reply({error:'Action failed'},503);
 }else{
 const u=new URL(a.config.url+'/rest/v1/profiles');u.searchParams.set('id','eq.'+b.id);u.searchParams.set('role','eq.patient');u.searchParams.set('select','id,approval_status');
 const r=await fetch(u,{method:'PATCH',headers:{...headers,Prefer:'return=representation'},body:JSON.stringify({approval_status:b.status}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});
 if(!r.ok)return reply({error:'Action failed'},r.status>=500?503:422);
 const rows=await r.json();if(rows?.length!==1||rows[0].id!==b.id||rows[0].approval_status!==b.status)return reply({error:'Account not found'},404);
 }
 return reply({status:b.status});
 }catch{return reply({error:'Unavailable'},503);}
}
