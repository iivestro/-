// Run on an isolated trusted Linux scanner host; requires ClamAV daemon and fresh signatures.
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const origin=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(origin!=='https://sfaatbfiwwbvobpvhwxo.supabase.co'||!key||process.env.STAGING_HEALTH_SCAN!=='enabled-after-validation')throw Error('Scanner disabled');
const headers={apikey:key,Authorization:'Bearer '+key};
async function rpc(name,body={}){const r=await fetch(origin+'/rest/v1/rpc/'+name,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('RPC failed');return r.json();}
const rows=await rpc('v2_health_scan_pending');let clean=0,rejected=0,errors=0;
for(const row of rows){
 if(!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(pdf|jpg|png)$/i.test(row.object_path))continue;
 const dir=await mkdtemp(join(tmpdir(),'patient-scan-'));
 try{
 const r=await fetch(origin+'/storage/v1/object/authenticated/patient-private-health/'+row.object_path,{headers,redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Fetch failed');
 const bytes=Buffer.from(await r.arrayBuffer());if(bytes.length>5242880||bytes.length<8)throw Error('Invalid size');
 const match=row.mime_type==='application/pdf'?bytes.subarray(0,5).toString()==='%PDF-':row.mime_type==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:row.mime_type==='image/png'&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 if(!match){await rpc('v2_health_scan_result',{p_id:row.id,p_clean:false});rejected++;continue;}
 const file=join(dir,'document');await writeFile(file,bytes,{mode:0o600,flag:'wx'});
 const scan=spawnSync('clamdscan',['--fdpass','--no-summary',file],{timeout:30000,stdio:'ignore',shell:false});
 if(scan.error||![0,1].includes(scan.status)){errors++;continue;}
 await rpc('v2_health_scan_result',{p_id:row.id,p_clean:scan.status===0});
 if(scan.status===0)clean++;else rejected++;
 }catch{errors++;}finally{await rm(dir,{recursive:true,force:true});}
}
console.log(JSON.stringify({clean,rejected,errors}));
