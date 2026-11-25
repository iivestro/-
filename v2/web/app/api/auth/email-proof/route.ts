import {authConfig,verifyUser} from '../../../../lib/auth';
export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
// This endpoint is for existing password-authenticated accounts, not public account creation.
export async function POST(req:Request){
 const cfg=authConfig(),origin=process.env.APP_ORIGIN;
 if(!cfg||cfg.url!=='https://sfaatbfiwwbvobpvhwxo.supabase.co'||process.env.STAGING_EMAIL_PROOF!=='enabled-after-provider-validation')return reply({error:'Email verification unavailable'},503);
 if(!origin||req.headers.get('origin')!==origin)return reply({error:'Forbidden'},403);
 const token=/^Bearer ([A-Za-z0-9._-]{1,8192})$/.exec(req.headers.get('authorization')??'')?.[1];
 if(!token)return reply({error:'Unauthorized'},401);
 if(!req.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return reply({error:'Invalid request'},415);
 try{
 const reader=req.body?.getReader();if(!reader)return reply({error:'Invalid request'},400);
 let raw='',n=0;const decoder=new TextDecoder();for(;;){const {done,value}=await reader.read();if(done)break;n+=value.byteLength;if(n>1024){await reader.cancel();return reply({error:'Too large'},413);}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();
 let b;try{b=JSON.parse(raw);}catch{return reply({error:'Invalid request'},400);}
 if(!b||typeof b!=='object'||!['start','verify'].includes(b.action)||b.action==='verify'&&(typeof b.code!=='string'||!/^[0-9]{6}$/.test(b.code)))return reply({error:'Invalid request'},400);
 const session=await verifyUser(token);if(!session)return reply({error:'Unauthorized'},401);
 const headers={apikey:cfg.key,Authorization:'Bearer '+token};
 const a=await fetch(cfg.url+'/auth/v1/user',{headers,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});
 if(!a.ok)return reply({error:'Unauthorized'},401);
 const u=await a.json();if(u.id!==session.id||typeof u.email!=='string'||!u.email||u.phone)return reply({error:'Email-only account required'},403);
 const url=new URL(cfg.url+'/rest/v1/profiles');url.searchParams.set('id','eq.'+session.id);url.searchParams.set('select','role,approval_status');url.searchParams.set('limit','1');
 const pr=await fetch(url,{headers,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});if(!pr.ok)return reply({error:'Unavailable'},503);
 const [p]=await pr.json();if(!p||!['admin','doctor','medical_center','representative','emergency_doctor','staff'].includes(p.role)||!['approved','pending'].includes(p.approval_status))return reply({error:'Forbidden'},403);
 const r=await fetch(cfg.url+'/auth/v1/'+(b.action==='start'?'otp':'verify'),{method:'POST',headers:{apikey:cfg.key,'Content-Type':'application/json'},body:JSON.stringify(b.action==='start'?{email:u.email,create_user:false}:{email:u.email,token:b.code,type:'email'}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!r.ok)return reply({error:'Email verification failed'},r.status===429?429:r.status>=500?503:422);
 if(b.action==='start')return reply({accepted:true},202);
 const data=await r.json();if(typeof data.access_token!=='string'||data.user?.id!==session.id||!Number.isFinite(data.expires_in)||data.expires_in<=0)return reply({error:'Verification failed'},403);
 const proof=await fetch(cfg.url+'/rest/v1/rpc/v2_record_email_proof',{method:'POST',headers:{apikey:cfg.key,Authorization:'Bearer '+data.access_token,'Content-Type':'application/json'},body:'{}',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});
 if(!proof.ok||await proof.json()!==true)return reply({error:'Proof unavailable'},403);
 return reply({access_token:data.access_token,expires_in:data.expires_in,verified:true});
 }catch{return reply({error:'Unavailable'},503);}
}
