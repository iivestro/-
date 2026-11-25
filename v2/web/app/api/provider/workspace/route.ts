import {authConfig,verifyUser} from '../../../../lib/auth';
export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function GET(request:Request){
 const token=/^Bearer ([A-Za-z0-9._-]{1,8192})$/.exec(request.headers.get('authorization')??'')?.[1];
 if(!token)return reply({error:'Unauthorized'},401);
 const config=authConfig();if(!config)return reply({error:'Unavailable'},503);
 const params=new URL(request.url).searchParams,kind=params.get('kind'),after=params.get('after');
 if(!kind||!['doctor','medical_center','representative','admin'].includes(kind)||(after&&!uuid.test(after)))return reply({error:'Invalid request'},400);
 try{
 const user=await verifyUser(token);if(!user)return reply({error:'Unauthorized'},401);
 if(!uuid.test(user.id))return reply({error:'Unavailable'},503);
 const read=async(table:string,query:Record<string,string>)=>{
 const url=new URL(config.url+'/rest/v1/'+table);for(const [k,v] of Object.entries(query))url.searchParams.set(k,v);
 const res=await fetch(url,{headers:{apikey:config.key,Authorization:'Bearer '+token},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});
 if(!res.ok)throw new Error('Unavailable');const rows:unknown=await res.json();if(!Array.isArray(rows))throw new Error('Unavailable');return rows;
 };
 const profiles=await read('profiles',{select:'id,role,approval_status',id:'eq.'+user.id,limit:'1'});
 const profile=profiles[0];if(profile?.id!==user.id||profile.role!==kind||profile.approval_status!=='approved')return reply({error:'Forbidden'},403);
 const page={order:'id.asc',limit:'26',...(after?{id:'gt.'+after}:{})};
 let rows;
 if(kind==='doctor'){
 const providers=await read('doctors',{select:'id',profile_id:'eq.'+user.id,is_active:'eq.true',admin_is_active:'eq.true',subscription_expires_at:'gt.'+new Date().toISOString(),limit:'1'});
 const id=providers[0]?.id;if(typeof id!=='string'||!uuid.test(id))return reply({error:'Forbidden'},403);
 rows=await read('appointments',{...page,select:'id,status,requested_date,appointment_at',doctor_id:'eq.'+id});
 }else if(kind==='medical_center'){
 const providers=await read('medical_centers',{select:'id',profile_id:'eq.'+user.id,is_active:'eq.true',subscription_expires_at:'gt.'+new Date().toISOString(),limit:'1'});
 const id=providers[0]?.id;if(typeof id!=='string'||!uuid.test(id))return reply({error:'Forbidden'},403);
 rows=await read('center_appointments',{...page,select:'id,status,requested_date,appointment_at',center_id:'eq.'+id});
 }else if(kind==='representative'){
 const accounts=await read('rep_accounts',{select:'profile_id,status',profile_id:'eq.'+user.id,status:'eq.approved',subscription_expires_at:'gt.'+new Date().toISOString(),limit:'1'});
 if(accounts[0]?.profile_id!==user.id)return reply({error:'Forbidden'},403);
 rows=await read('rep_appointments',{...page,select:'id,status,created_at',rep_profile_id:'eq.'+user.id});
 }else{
 rows=await read('profiles',{...page,select:'id,role,approval_status,created_at'});
 }
 const items=rows.slice(0,25).map(({id,status,requested_date,appointment_at,role,approval_status,created_at})=>({id,status,requested_date,appointment_at,role,approval_status,created_at}));
 return reply({items,next:rows.length>25?items[24].id:null});
 }catch{return reply({error:'Unavailable'},503);}
}
