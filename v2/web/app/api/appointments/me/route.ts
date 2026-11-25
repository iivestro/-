import {authConfig,verifyUser} from '../../../../lib/auth';
export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(request:Request){
 const token=/^Bearer ([A-Za-z0-9._-]{1,8192})$/.exec(request.headers.get('authorization')??'')?.[1];
 if(!token)return reply({error:'Unauthorized'},401);
 const config=authConfig();if(!config)return reply({error:'Unavailable'},503);
 try{
 const user=await verifyUser(token);if(!user)return reply({error:'Unauthorized'},401);
 const get=async(table:string,params:Record<string,string>)=>{
 const url=new URL(config.url+'/rest/v1/'+table);
 for(const [key,value] of Object.entries(params))url.searchParams.set(key,value);
 const res=await fetch(url,{headers:{apikey:config.key,Authorization:'Bearer '+token},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});
 if(!res.ok)throw new Error('Database request failed');
 const data:unknown=await res.json();if(!Array.isArray(data))throw new Error('Invalid result');return data;
 };
 const profiles=await get('profiles',{select:'id,role,approval_status',id:'eq.'+user.id,limit:'1'});
 if(profiles[0]?.id!==user.id||profiles[0]?.role!=='patient'||profiles[0]?.approval_status!=='approved')return reply({error:'Forbidden'},403);
 const kind=new URL(request.url).searchParams.get('kind')??'doctor';
 if(kind!=='doctor'&&kind!=='center')return reply({error:'Invalid kind'},400);
 const after=new URL(request.url).searchParams.get('after');
 if(after&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(after))return reply({error:'Invalid cursor'},400);
 const rows=await get(kind==='doctor'?'appointments':'center_appointments',{select:'id,patient_id,status,requested_date,appointment_at',patient_id:'eq.'+user.id,order:'id.asc',limit:'26',...(after?{id:'gt.'+after}:{})});
 if(rows.some(r=>r.patient_id!==user.id))return reply({error:'Unavailable'},503);
 const items=rows.slice(0,25).map(({id,status,requested_date,appointment_at})=>({id,status,requested_date,appointment_at}));
 return reply({items,next:rows.length>25?items[24].id:null});
 }catch{return reply({error:'Unavailable'},503);}
}
