import {authConfig,approvedPatient} from '../../../../lib/auth';
export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(request:Request){
 const token=/^Bearer ([A-Za-z0-9._-]{1,8192})$/.exec(request.headers.get('authorization')??'')?.[1];
 if(!token)return reply({error:'Unauthorized'},401);
 const config=authConfig();if(!config)return reply({error:'Unavailable'},503);
 const params=new URL(request.url).searchParams;
 const id=params.get('id')??'',kind=params.get('kind'),after=params.get('after');
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 if(!uuid.test(id)||(kind!=='doctor'&&kind!=='center')||(after&&!uuid.test(after)))return reply({error:'Invalid request'},400);
 try{
 const access=await approvedPatient(token);
 if(access.status!==200)return reply({error:access.status===403?'Forbidden':access.status===401?'Unauthorized':'Unavailable'},access.status);
 const read=async(table:string,query:Record<string,string>)=>{
 const url=new URL(config.url+'/rest/v1/'+table);for(const [k,v] of Object.entries(query))url.searchParams.set(k,v);
 const res=await fetch(url,{headers:{apikey:config.key,Authorization:'Bearer '+token},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});
 if(!res.ok)throw new Error('Unavailable');
 const rows:unknown=await res.json();if(!Array.isArray(rows))throw new Error('Unavailable');return rows;
 };
 const filters={select:'id',id:'eq.'+id,is_active:'eq.true',subscription_expires_at:'gt.'+new Date().toISOString(),limit:'1'};
 const parent=await read(kind==='doctor'?'doctors':'medical_centers',kind==='doctor'?{...filters,admin_is_active:'eq.true'}:filters);
 if(parent[0]?.id!==id)return reply({error:'Not found'},404);
 if(kind==='doctor'){
 const items=await read('doctor_schedules',{select:'day_of_week,start_time,end_time',doctor_id:'eq.'+id,is_available:'eq.true',order:'day_of_week.asc,start_time.asc',limit:'100'});
 return reply({items,next:null});
 }
 const rows=await read('center_doctors',{select:'id,full_name,specialty,qualification,experience_years,consultation_fee',center_id:'eq.'+id,is_active:'eq.true',order:'id.asc',limit:'26',...(after?{id:'gt.'+after}:{})});
 const items=rows.slice(0,25);return reply({items,next:rows.length>25?items[24].id:null});
 }catch{return reply({error:'Unavailable'},503);}
}
