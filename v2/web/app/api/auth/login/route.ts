import {authConfig} from '../../../../lib/auth';
export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export async function POST(request:Request){
 const origin=process.env.APP_ORIGIN;
 if(!origin)return reply({error:'Unavailable'},503);
 if(request.headers.get('origin')!==origin)return reply({error:'Forbidden'},403);
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return reply({error:'Invalid request'},415);
 const config=authConfig();if(!config)return reply({error:'Unavailable'},503);
 try{
 const reader=request.body?.getReader();if(!reader)return reply({error:'Invalid request'},400);
 let size=0;const decoder=new TextDecoder();let raw='';
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>4096){await reader.cancel();return reply({error:'Invalid request'},413);}raw+=decoder.decode(value,{stream:true});}
 raw+=decoder.decode();let body:unknown;try{body=JSON.parse(raw);}catch{return reply({error:'Invalid request'},400);}
 if(!body||typeof body!=='object'||!('password' in body)||typeof body.password!=='string'||!body.password||body.password.length>1024)return reply({error:'Invalid request'},400);
 const identity='phone' in body&&typeof body.phone==='string'&&/^07[0-9]{9}$/.test(body.phone)?{phone:'+964'+body.phone.slice(1)}:'email' in body&&typeof body.email==='string'&&body.email.length<=254&&body.email.includes('@')?{email:body.email.trim()}:null;
 if(!identity)return reply({error:'Invalid request'},400);
 if('phone' in identity&&(config.url!=='https://sfaatbfiwwbvobpvhwxo.supabase.co'||process.env.STAGING_WHATSAPP_WRITES!=='enabled-after-provider-validation'))return reply({error:'Unavailable'},503);
 const res=await fetch(config.url+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:config.key,'Content-Type':'application/json'},body:JSON.stringify({...identity,password:body.password}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});
 if(!res.ok)return reply({error:res.status===429?'Try later':res.status>=500?'Unavailable':'Invalid credentials'},res.status===429?429:res.status>=500?503:401);
 const data=await res.json();if(typeof data.access_token!=='string'||! /^[A-Za-z0-9._-]{1,8192}$/.test(data.access_token)||!Number.isFinite(data.expires_in)||data.expires_in<=0)return reply({error:'Unavailable'},503);
 return reply({access_token:data.access_token,expires_in:data.expires_in});
 }catch{return reply({error:'Unavailable'},503);}
}
