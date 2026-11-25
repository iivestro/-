import {authConfig,verifyUser} from '../../../../lib/auth';
export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function GET(request:Request){
 const token=/^Bearer ([A-Za-z0-9._-]{1,8192})$/.exec(request.headers.get('authorization')??'')?.[1];
 if(!token)return reply({error:'Unauthorized'},401);
 const config=authConfig();if(!config)return reply({error:'Unavailable'},503);
 const p=new URL(request.url).searchParams,section=p.get('section'),role=p.get('role'),after=p.get('after');
 if(!['notifications','subscription','schedule','visits'].includes(section??'')||(after&&!uuid.test(after)))return reply({error:'Invalid request'},400);
 try{
 const user=await verifyUser(token);if(!user)return reply({error:'Unauthorized'},401);if(!uuid.test(user.id))return reply({error:'Unavailable'},503);
 const read=async(table:string,query:Record<string,string>)=>{
 const url=new URL(config.url+'/rest/v1/'+table);for(const [k,v] of Object.entries(query))url.searchParams.set(k,v);
 const res=await fetch(url,{headers:{apikey:config.key,Authorization:'Bearer '+token},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});
 if(!res.ok)throw new Error('Unavailable');const rows=await res.json();if(!Array.isArray(rows))throw new Error('Unavailable');return rows;
 };
 const page={order:'id.asc',limit:'26',...(after?{id:'gt.'+after}:{})};
 let rows;
 if(section==='notifications'){
 rows=await read('notifications',{...page,select:'id,title,message,is_read,created_at',user_id:'eq.'+user.id});
 }else{
 const profiles=await read('profiles',{select:'id,role,approval_status',id:'eq.'+user.id,limit:'1'});
 if(role!=='home_provider'&&(profiles[0]?.id!==user.id||profiles[0].role!==role||profiles[0].approval_status!=='approved'))return reply({error:'Forbidden'},403);
 if(section==='subscription'){
 const roles:Record<string,[string,string]>={doctor:['doctors','profile_id'],medical_center:['medical_centers','profile_id'],representative:['rep_accounts','profile_id'],home_provider:['home_service_providers','account_id']};
 const target=role&&roles[role];if(!target)return reply({error:'Forbidden'},403);
 const [table,key]=target;
 rows=await read(table,{select:'subscription_expires_at,subscription_fee', [key]:'eq.'+user.id,limit:'2'});
 if(rows.length!==1)return reply({error:'Not found'},404);
 return reply({items:rows,next:null});
 }else if(role==='doctor'){
 const providers=await read('doctors',{select:'id',profile_id:'eq.'+user.id,is_active:'eq.true',admin_is_active:'eq.true',subscription_expires_at:'gt.'+new Date().toISOString(),limit:'2'});
 if(providers.length!==1||!uuid.test(providers[0].id))return reply({error:'Forbidden'},403);
 rows=section==='schedule'?await read('doctor_schedules',{...page,select:'id,day_of_week,start_time,end_time,is_available,unlimited_daily,max_daily_patients',doctor_id:'eq.'+providers[0].id}):await read('rep_visit_slots',{...page,select:'id,visit_date,start_time,end_time,capacity,is_open',doctor_id:'eq.'+providers[0].id});
 }else if(role==='representative'&&section==='visits'){
 const accounts=await read('rep_accounts',{select:'profile_id',profile_id:'eq.'+user.id,status:'eq.approved',subscription_expires_at:'gt.'+new Date().toISOString(),limit:'1'});
 if(accounts[0]?.profile_id!==user.id)return reply({error:'Forbidden'},403);
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Baghdad',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 rows=await read('rep_visit_slots',{...page,select:'id,visit_date,start_time,end_time,capacity,is_open',is_open:'eq.true',visit_date:'gte.'+today});
 }else return reply({error:'Forbidden'},403);
 }
 const items=rows.slice(0,25);return reply({items,next:rows.length>25?items[24].id:null});
 }catch{return reply({error:'Unavailable'},503);}
}
