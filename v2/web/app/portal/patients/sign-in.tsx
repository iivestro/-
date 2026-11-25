'use client';
import {useEffect,useState,type FormEvent} from 'react';
import Directory from './directory';
import Appointments from './appointments';
type Session={token:string;name:string;expiresAt:number};
export default function PatientSignIn(){
 const [session,setSession]=useState<Session|null>(null);
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 useEffect(()=>{if(!session)return;const timer=setTimeout(()=>{setSession(null);setNotice('انتهت الجلسة، يرجى تسجيل الدخول مجدداً.');},Math.max(0,session.expiresAt-Date.now()));return()=>clearTimeout(timer);},[session]);
 async function submit(e:FormEvent<HTMLFormElement>){
 e.preventDefault();if(busy)return;const form=e.currentTarget;const data=new FormData(form);setBusy(true);setNotice('');
 try{
 const response=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:data.get('email'),password:data.get('password')}),cache:'no-store'});
 form.reset();
 if(!response.ok){setNotice(response.status===429?'محاولات كثيرة، حاول لاحقاً.':response.status===401?'بيانات الدخول غير صحيحة.':'تسجيل الدخول غير متاح حالياً.');return;}
 const login=await response.json();
 const res=await fetch('/api/profile/me',{headers:{Authorization:'Bearer '+login.access_token},cache:'no-store'});
 if(!res.ok){setNotice('تعذر التحقق من الحساب.');return;}
 const profile=await res.json();
 if(profile.role!=='patient'||profile.approval_status!=='approved'){setNotice('هذه البوابة مخصصة لحسابات المراجعين الموافق عليها.');return;}
 setSession({token:login.access_token,name:profile.full_name??'المراجع',expiresAt:Date.now()+Math.min(login.expires_in,3600)*1000});
 }catch{setNotice('تعذر الاتصال. حاول مجدداً.');}finally{form.reset();setBusy(false);}
 }
 if(session)return <><p>أهلاً {session.name}</p><button onClick={()=>{setSession(null);setNotice('تم إنهاء الجلسة المحلية.');}}>خروج</button><Directory token={session.token}/><Appointments token={session.token}/></>;
 return <article><h2>تسجيل دخول المراجع</h2><p>نسخة اختبارية — استخدم حساباً وهمياً فقط.</p><form onSubmit={submit} className="login-form"><label htmlFor="email">البريد الإلكتروني</label><input id="email" name="email" type="email" autoComplete="username" maxLength={254} required disabled={busy}/><label htmlFor="password">كلمة المرور</label><input id="password" name="password" type="password" autoComplete="current-password" maxLength={1024} required disabled={busy}/><button type="submit" disabled={busy}>{busy?'جارٍ التحقق':'دخول'}</button></form><p role="status">{notice}</p></article>;
}
