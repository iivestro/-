import {timingSafeEqual} from 'node:crypto';
import {authConfig} from '../../../../lib/auth';
export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
function equal(a:string,b:string){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
export async function POST(req:Request){
 const cfg=authConfig(),service=process.env.SUPABASE_SERVICE_ROLE_KEY,worker=process.env.PATIENT_WORKER_SECRET,expo=process.env.EXPO_PUSH_ACCESS_TOKEN;
 if(!cfg||cfg.url!=='https://sfaatbfiwwbvobpvhwxo.supabase.co'||process.env.STAGING_PUSH_DELIVERY!=='enabled-after-validation'||!worker||worker.length<32||!service||!expo)return reply({error:'Disabled'},503);
 if(!equal(req.headers.get('authorization')??'','Bearer '+worker))return reply({error:'Forbidden'},403);
 async function rpc(name:string,body:object={}){
 const r=await fetch(cfg!.url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:service!,Authorization:'Bearer '+service,'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('RPC');return r.json();
 }
 async function send(path:'send'|'getReceipts',payload:unknown){
 const r=await fetch('https://exp.host/--/api/v2/push/'+path,{method:'POST',headers:{Authorization:'Bearer '+expo,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(payload),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('Provider');return r.json();
 }
 try{
 const reminders=await rpc('v2_enqueue_reminders');
 const claimed=await rpc('v2_push_claim') as {id:number;expo_token:string}[];
 let accepted=0,failed=0;
 if(claimed.length){
 let tickets:unknown;
 try{tickets=(await send('send',claimed.map(x=>({to:x.expo_token,title:'بيشنت',body:'لديك تحديث جديد. افتح التطبيق لمراجعة التفاصيل.',ttl:900,priority:'normal'})))).data;}catch{tickets=null;}
 for(let i=0;i<claimed.length;i++){
 const t=Array.isArray(tickets)?tickets[i]:null;
 const id=t?.status==='ok'&&typeof t.id==='string'?t.id:null;
 const reason=id?null:t?.details?.error==='DeviceNotRegistered'?'DeviceNotRegistered':'send_failed';
 await rpc('v2_push_ticket',{p_id:claimed[i].id,p_ticket:id,p_error:reason});
 if(id)accepted++;else failed++;
 }}
 const pending=await rpc('v2_push_receipts') as {id:number;ticket_id:string}[];
 if(pending.length){
 const receipts=(await send('getReceipts',{ids:pending.map(x=>x.ticket_id)})).data??{};
 for(const p of pending){const r=receipts[p.ticket_id];const status=r?.status==='ok'?'provider_accepted':r?.details?.error==='DeviceNotRegistered'?'DeviceNotRegistered':r?.status==='error'?'receipt_failed':'awaiting_receipt';await rpc('v2_push_receipt_result',{p_id:p.id,p_status:status});}
 }
 return reply({reminders,accepted_by_expo:accepted,failed,receipts_checked:pending.length});
 }catch{return reply({error:'Worker failed'},503);}
}
