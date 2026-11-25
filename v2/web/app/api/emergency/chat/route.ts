import {authConfig,verifyUser} from '../../../../lib/auth';
export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
export async function POST(request:Request){
 const config=authConfig(),origin=process.env.APP_ORIGIN;
 if(!config||!origin||config.url!=='https://sfaatbfiwwbvobpvhwxo.supabase.co'||process.env.STAGING_EMERGENCY_IMAGES!=='enabled-after-validation')return reply({error:'Emergency chat disabled'},503);
 if(request.headers.get('origin')!==origin)return reply({error:'Forbidden'},403);
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return reply({error:'Invalid request'},415);
 try{
 const reader=request.body?.getReader();if(!reader)return reply({error:'Invalid request'},400);
 let size=0,raw='';const decoder=new TextDecoder();for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1420000){await reader.cancel();return reply({error:'Too large'},413);}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();
 let b;try{b=JSON.parse(raw);}catch{return reply({error:'Invalid request'},400);}
 if(!b||typeof b!=='object'||Array.isArray(b)||!['create_chat','visitor_get','visitor_send','visitor_send_image','visitor_image','doctor_list','doctor_get','doctor_send','doctor_send_image','doctor_image'].includes(b.action))return reply({error:'Invalid request'},400);
 const doctor=b.action.startsWith('doctor_');
 const token=/^Bearer ([A-Za-z0-9._-]{1,8192})$/.exec(request.headers.get('authorization')??'')?.[1];
 if(doctor&&(!token||!(await verifyUser(token))))return reply({error:'Unauthorized'},401);
 const res=await fetch(config.url+'/functions/v1/emergency-chat-images',{method:'POST',headers:{apikey:config.key,Authorization:'Bearer '+(doctor?token:config.key),'Content-Type':'application/json'},body:raw,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(12000)});
 if(!res.ok)return reply({error:'Chat request failed'},res.status===429?429:res.status===403?403:res.status===401?401:res.status===400?400:503);
 const result=await res.json();return reply(result);
 }catch{return reply({error:'Unavailable'},503);}
}
