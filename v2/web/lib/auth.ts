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
