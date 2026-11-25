import {authConfig,verifyUser} from '../../../lib/auth';
export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export async function POST(request:Request){
 const config=authConfig(),origin=process.env.APP_ORIGIN;
 if(!config||!origin||config.url!=='https://sfaatbfiwwbvobpvhwxo.supabase.co'||process.env.STAGING_FEATURE_EXPANSION!=='enabled-after-validation')return reply({error:'Feature disabled'},503);
 if(request.headers.get('origin')!==origin)return reply({error:'Forbidden'},403);
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return reply({error:'Invalid request'},415);
 const token=/^Bearer ([A-Za-z0-9._-]{1,8192})$/.exec(request.headers.get('authorization')??'')?.[1];if(!token)return reply({error:'Unauthorized'},401);
 try{
 const reader=request.body?.getReader();if(!reader)return reply({error:'Invalid request'},400);
 let raw='',size=0;const decoder=new TextDecoder();for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>10000){await reader.cancel();return reply({error:'Too large'},413);}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();
 let b;try{b=JSON.parse(raw);}catch{return reply({error:'Invalid request'},400);}
 if(!b||typeof b!=='object'||Array.isArray(b)||typeof b.action!=='string'||!/^[a-z_]{3,40}$/.test(b.action)||!b.data||typeof b.data!=='object'||Array.isArray(b.data))return reply({error:'Invalid request'},400);
 if(!await verifyUser(token))return reply({error:'Unauthorized'},401);
 const r=await fetch(config.url+'/rest/v1/rpc/v2_feature_action',{method:'POST',headers:{apikey:config.key,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({p_action:b.action,p_data:b.data}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});
 if(!r.ok)return reply({error:'Request unavailable'},r.status===401?401:r.status===403?403:r.status===429?429:r.status===400?400:503);
 return reply({result:await r.json()});
 }catch{return reply({error:'Unavailable'},503);}
}
