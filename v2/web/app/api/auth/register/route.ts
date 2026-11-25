import {authConfig} from '../../../../lib/auth';
export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
const governorates=['بغداد','النجف','كربلاء','بابل','القادسية','المثنى','ذي قار','ميسان','البصرة','واسط','ديالى','صلاح الدين','الأنبار','نينوى','كركوك','أربيل','دهوك','السليمانية','حلبجة'];
export async function POST(request:Request){
 const config=authConfig(),origin=process.env.APP_ORIGIN;
 if(!config||!origin)return reply({error:'Unavailable'},503);
 if(request.headers.get('origin')!==origin)return reply({error:'Forbidden'},403);
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return reply({error:'Invalid request'},415);
 try{
 const reader=request.body?.getReader();if(!reader)return reply({error:'Invalid request'},400);
 let size=0,raw='';const decoder=new TextDecoder();
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8192){await reader.cancel();return reply({error:'Invalid request'},413);}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();
 let b;try{b=JSON.parse(raw);}catch{return reply({error:'Invalid request'},400);}
 if(!b||typeof b!=='object'||Array.isArray(b)||b.accountType!=='representative'||typeof b.fullName!=='string'||b.fullName.trim().length<3||b.fullName.trim().length>120||typeof b.email!=='string'||b.email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email.trim())||typeof b.password!=='string'||b.password.length<12||b.password.length>128||typeof b.phone!=='string'||!/^07[0-9]{9}$/.test(b.phone)||!governorates.includes(b.governorate))return reply({error:'Invalid registration'},400);
 if(b.accountType==='representative'&&(b.fullName.trim().split(/\s+/).length<3||!['scientific_office','company'].includes(b.employerType)||typeof b.employerName!=='string'||b.employerName.trim().length<2||b.employerName.trim().length>180))return reply({error:'Invalid representative details'},400);
 if(config.url!=='https://sfaatbfiwwbvobpvhwxo.supabase.co'||process.env.STAGING_REGISTRATION_WRITES!=='enabled-after-validation')return reply({error:'Registration disabled'},503);
 const data={account_type:b.accountType,full_name:b.fullName.trim(),phone:b.phone,governorate:b.governorate,...(b.accountType==='representative'?{employer_type:b.employerType,employer_name:b.employerName.trim()}: {})};
 // New patient signup uses the separate phone endpoint. This endpoint is representative-only.
 // No client-provided role, approval status, redirect URL or privileged metadata is forwarded.
 const r=await fetch(config.url+'/auth/v1/signup',{method:'POST',headers:{apikey:config.key,'Content-Type':'application/json'},body:JSON.stringify({email:b.email.trim(),password:b.password,data}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
 if(r.status===429)return reply({error:'Try later'},429);
 if(r.status>=500)return reply({error:'Unavailable'},503);
 if(!r.ok){const e=await r.json().catch(()=>null);if(!['user_already_exists','email_exists'].includes(e?.code))return reply({error:'Registration unavailable or invalid'},422);}
 // Do not reveal account existence or return a session, even if confirmation is disabled upstream.
 return reply({accepted:true},202);
 }catch{return reply({error:'Unavailable'},503);}
}
