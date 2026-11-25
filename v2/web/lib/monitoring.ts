import 'server-only';
import {authConfig} from './auth';
type Component='auth'|'booking'|'queue'|'support'|'push'|'storage'|'directory'|'emergency'|'admin';
type Event='api_error'|'notification_failed'|'storage_error'|'database_error';
// Best-effort, strictly allowlisted counters. Never pass request bodies, IDs, exceptions or tokens.
export async function recordOperationalEvent(component:Component,event:Event='api_error'){
 const cfg=authConfig(),key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!cfg||cfg.url!=='https://sfaatbfiwwbvobpvhwxo.supabase.co'||!key||process.env.STAGING_MONITORING!=='enabled-after-validation')return;
 try{await fetch(cfg.url+'/rest/v1/rpc/v2_record_operational_event',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({p_component:component,p_event_type:event}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(1500)});}catch{}
}
