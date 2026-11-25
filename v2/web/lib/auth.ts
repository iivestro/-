import 'server-only';
export function authConfig() {
 const url=process.env.SUPABASE_URL;
 const key=process.env.SUPABASE_PUBLISHABLE_KEY;
 if (!url || !key || !key.startsWith('sb_publishable_')) return null;
 try { const parsed=new URL(url); if(parsed.protocol!=='https:' || !parsed.hostname.endsWith('.supabase.co') || parsed.pathname!=='/' || parsed.username || parsed.password || parsed.search || parsed.hash) return null; return {url:parsed.origin,key}; } catch { return null; }
}
export async function verifyUser(token:string) {
 const config=authConfig();
 if(!config) return null;
 const response=await fetch(config.url+'/auth/v1/user',{headers:{apikey:config.key,Authorization:'Bearer '+token},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});
 if(!response.ok) return null;
 const user:unknown=await response.json();
 if(typeof user!=='object'||user===null||!('id' in user)||typeof user.id!=='string') return null;
 return {id:user.id};
}

export async function approvedPatient(token:string):Promise<{status:200;id:string}|{status:401|403|503}> {
 const config=authConfig();if(!config)return {status:503};
 const user=await verifyUser(token);if(!user)return {status:401};
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id))return {status:503};
 const url=new URL(config.url+'/rest/v1/profiles');
 url.searchParams.set('id','eq.'+user.id);url.searchParams.set('select','id,role,approval_status');url.searchParams.set('limit','1');
 const res=await fetch(url,{headers:{apikey:config.key,Authorization:'Bearer '+token},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});
 if(!res.ok)return {status:503};
 const data:unknown=await res.json();if(!Array.isArray(data))return {status:503};
 const profile=data[0];
 if(profile?.id!==user.id||profile?.role!=='patient'||profile?.approval_status!=='approved')return {status:403};
 return {status:200,id:user.id};
}
