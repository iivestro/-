import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
const staging='https://sfaatbfiwwbvobpvhwxo.supabase.co';
const base='http://127.0.0.1:3218';
// Reuse the already-established synthetic account from the legacy staging fixture.
// Never print credentials, tokens, profile fields, response bodies or environment.
const fixture=await readFile('../../legacy-test/tests/load/functional.js','utf8');
assert.ok(fixture.includes(staging),'Staging fixture mismatch');
const key=fixture.match(/const key='(sb_publishable_[A-Za-z0-9_-]+)'/)?.[1];
const creds=fixture.match(/JSON\.stringify\(\{email:'([^'\\]+)',password:'([^'\\]+)'\}\)/);
assert.ok(key&&creds,'Synthetic fixture format changed');
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3218'],{stdio:'ignore',env:{...process.env,APP_ORIGIN:base,SUPABASE_URL:staging,SUPABASE_PUBLISHABLE_KEY:key,STAGING_BOOKING_WRITES:'disabled',STAGING_ADMIN_WRITES:'disabled'}});
let token;
try {
 let ready=false;
 for(let i=0;i<40;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}await delay(500);}
 assert.ok(ready,'Server startup failed');
 const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({email:creds[1],password:creds[2]})});
 assert.equal(login.status,200,'Synthetic account sign-in');
 const session=await login.json();token=session.access_token;assert.ok(typeof token==='string'&&token.length>0,'Access token missing');
 console.log('PASS actual synthetic password sign-in');
 const headers={Authorization:'Bearer '+token};
 const profile=await fetch(base+'/api/profile/me',{headers});assert.equal(profile.status,200,'Own profile');
 const data=await profile.json();assert.equal(data.role,'patient');assert.equal(data.approval_status,'approved');
 console.log('PASS approved patient profile');
 for(const route of ['/api/directory/doctors','/api/directory/centers','/api/appointments/me?kind=doctor','/api/appointments/me?kind=center']){
 const res=await fetch(base+route,{headers});assert.equal(res.status,200,route);assert.ok(Array.isArray((await res.json()).items));assert.match(res.headers.get('cache-control')??'',/no-store/);console.log('PASS '+route);
 }
 for(const role of ['admin','doctor','medical_center','representative','home_provider']){
 const res=await fetch(base+'/api/provider/workspace?kind='+role,{headers});assert.equal(res.status,403,'Patient must not access '+role);
 }
 console.log('PASS role isolation for five restricted workspaces');
 for(const [route,expected] of [['/api/admin/accounts',403],['/api/admin/accounts?role=patient',403],['/api/account/overview?section=subscription&role=doctor',403],['/api/account/overview?section=schedule&role=doctor',403],['/api/account/overview?section=visits&role=representative',403],['/api/account/overview?section=notifications&role=patient',200]]){
 const r=await fetch(base+route,{headers});assert.equal(r.status,expected,route);console.log('PASS '+route+' HTTP '+expected);
 }
 for(const [route,expected] of [['/api/admin/accounts',403],['/api/appointments/decision',503]]){
 const r=await fetch(base+route,{method:'POST',headers:{...headers,Origin:base,'Content-Type':'application/json'},body:'{}'});assert.equal(r.status,expected,route);console.log('PASS protected write '+route);
 }
 const unauth=await fetch(base+'/api/admin/accounts');assert.equal(unauth.status,401);console.log('PASS unauthenticated admin denied');
 const keyRes=await fetch(base+'/api/appointments/request',{headers});assert.equal(keyRes.status,200);const bookingKey=await keyRes.json();assert.equal(bookingKey.writesEnabled,false);assert.match(bookingKey.requestId,/^[0-9a-f-]{36}$/i);console.log('PASS booking request identifier and closed write gate');
 const blocked=await fetch(base+'/api/appointments/request',{method:'POST',headers:{...headers,Origin:base,'Content-Type':'application/json'},body:'{}'});assert.equal(blocked.status,503);console.log('PASS booking gate remains closed');
}finally{
 if(token){try{const res=await fetch(base+'/api/auth/logout',{method:'POST',headers:{Authorization:'Bearer '+token,Origin:base}});console.log('Local session sign-out HTTP '+res.status);}catch{console.log('Local session sign-out unavailable');}}
 server.kill('SIGTERM');
}
