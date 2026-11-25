import http from 'k6/http';
import {check,sleep} from 'k6';
const base='https://sfaatbfiwwbvobpvhwxo.supabase.co';
const key='sb_publishable_CBPPwjIcmVbGK1fr8EHyYg_DlfldbK6';
export const options={vus:Number(__ENV.LOAD_VUS||5),duration:__ENV.LOAD_DURATION||'30s',thresholds:{checks:['rate==1'],http_req_failed:[{threshold:'rate<0.01',abortOnFail:true,delayAbortEval:'15s'}],http_req_duration:[{threshold:'p(95)<1000',abortOnFail:true,delayAbortEval:'15s'}]}};
export function setup(){
 const r=http.post(base+'/auth/v1/token?grant_type=password',JSON.stringify({email:'http-smoke@example.invalid',password:'StageOnly-md55f8c8bl83innu2469ihxklu2b8yjrh8x145otwsa'}),{headers:{apikey:key,'Content-Type':'application/json'}});
 if(r.status!==200) throw new Error('Synthetic login failed: '+r.status);
 return {token:r.json('access_token')};
}
export default function(data){
 const r=http.post(base+'/rest/v1/rpc/home_service_directory','{}',{headers:{apikey:key,Authorization:'Bearer '+data.token,'Content-Type':'application/json'}});
 check(r,{'authenticated directory succeeds':x=>x.status===200});
 sleep(2);
}
