import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
const base='http://127.0.0.1:3217';
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3217'],{stdio:'inherit',env:{...process.env,APP_ORIGIN:base,SUPABASE_URL:'',SUPABASE_PUBLISHABLE_KEY:''}});
try {
 let ready=false;
 for(let i=0;i<60;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{} await delay(500);}
 assert.ok(ready,'Server did not start');
 const health=await fetch(base+'/api/health');
 assert.equal((await health.json()).status,'ok');
 assert.equal(health.headers.get('x-content-type-options'),'nosniff');
 assert.equal(health.headers.get('x-frame-options'),'DENY');
 for(const authorization of ['', 'Basic abc','Bearer invalid token']){
  const res=await fetch(base+'/api/auth/me',{headers:authorization?{authorization}:{}});
  assert.equal(res.status,401);
  assert.match(res.headers.get('cache-control')??'',/no-store/);
 }
 const unavailable=await fetch(base+'/api/auth/me',{headers:{authorization:'Bearer abc.def.ghi'}});
 assert.equal(unavailable.status,503);
 assert.equal((await unavailable.json()).error,'Unavailable');
 const profile=await fetch(base+'/api/profile/me');
 assert.equal(profile.status,401);
 assert.match(profile.headers.get('cache-control')??'',/no-store/);
 const profileUnavailable=await fetch(base+'/api/profile/me',{headers:{authorization:'Bearer abc.def.ghi'}});
 assert.equal(profileUnavailable.status,503);
 for(const path of ['/api/directory/centers','/api/directory/doctors']){
 const denied=await fetch(base+path);assert.equal(denied.status,401);
 assert.match(denied.headers.get('cache-control')??'',/no-store/);
 const unavailable=await fetch(base+path,{headers:{authorization:'Bearer abc.def.ghi'}});assert.equal(unavailable.status,503);
 }
 const portal=await fetch(base+'/portal/patients');assert.equal(portal.status,200);assert.match(await portal.text(),/تسجيل دخول المراجع/);
 const loginHeaders={'Content-Type':'application/json',Origin:base};
 const blocked=await fetch(base+'/api/auth/login',{method:'POST',headers:{...loginHeaders,Origin:'https://example.invalid'},body:'{}'});assert.equal(blocked.status,403);
 const login=await fetch(base+'/api/auth/login',{method:'POST',headers:loginHeaders,body:'{}'});assert.equal(login.status,503);
 assert.match(login.headers.get('cache-control')??'',/no-store/);
 console.log('Smoke checks passed');
} finally {server.kill('SIGTERM');}
