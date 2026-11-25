import {authConfig,approvedPatient} from '../../../../lib/auth';
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
 let raw='',size=0;const decoder=new TextDecoder();for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8192){await reader.cancel();return reply({error:'Invalid request'},413);}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();
 let b;try{b=JSON.parse(raw);}catch{return reply({error:'Invalid request'},400);}
 if(!b||typeof b!=='object'||Array.isArray(b)||typeof b.phone!=='string'||!/^07[0-9]{9}$/.test(b.phone)||!['start','verify'].includes(b.action))return reply({error:'Invalid request'},400);
 if(b.action==='start'&&(typeof b.fullName!=='string'||b.fullName.trim().length<3||b.fullName.trim().length>120||!Number.isInteger(b.age)||b.age<1||b.age>120||!governorates.includes(b.governorate)||typeof b.password!=='string'||b.password.length<12||b.password.length>128))return reply({error:'Invalid registration'},400);
 if(b.action==='verify'&&(typeof b.code!=='string'||!/^[0-9]{6}$/.test(b.code)))return reply({error:'Invalid code'},400);
 if(config.url!=='https://sfaatbfiwwbvobpvhwxo.supabase.co'||process.env.STAGING_WHATSAPP_WRITES!=='enabled-after-provider-validation')return reply({error:'WhatsApp verification unavailable'},503);
 const phone='+964'+b.phone.slice(1);
 const headers={apikey:config.key,'Content-Type':'application/json'};
 const payload=b.action==='start'?{phone,password:b.password,channel:'whatsapp',data:{account_type:'patient',full_name:b.fullName.trim(),age:b.age,governorate:b.governorate}}:{phone,token:b.code,type:'sms'};
 const res=await fetch(config.url+'/auth/v1/'+(b.action==='start'?'signup':'verify'),{method:'POST',headers,body:JSON.stringify(payload),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
 if(res.status===429)return reply({error:'Try later'},429);
 if(!res.ok)return reply({error:'Verification unavailable or invalid'},res.status>=500?503:422);
 const result=await res.json();
 if(b.action==='start'){
 // A session here implies a misconfigured auto-confirm provider: fail closed.
 if(result.access_token||result.session)return reply({error:'Confirmation configuration invalid'},503);
 return reply({accepted:true},202);
 }
 if(typeof result.access_token!=='string'||!/^[A-Za-z0-9._-]{1,8192}$/.test(result.access_token)||!Number.isFinite(result.expires_in)||result.expires_in<=0)return reply({error:'Unavailable'},503);
 const p=await approvedPatient(result.access_token);
 if(p.status!==200)return reply({error:'Account unavailable'},403);
 return reply({access_token:result.access_token,expires_in:result.expires_in});
 }catch{return reply({error:'Unavailable'},503);}
}
