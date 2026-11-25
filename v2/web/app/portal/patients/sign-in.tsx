'use client';
import FeaturePanel from '../feature-panel';
import {useEffect,useState,type FormEvent} from 'react';
import Directory from './directory';
import Appointments from './appointments';
type Session={token:string;name:string;expiresAt:number};
export default function PatientSignIn(){
 const [session,setSession]=useState<Session|null>(null);
 const [busy,setBusy]=useState(false);
 const [mode,setMode]=useState<'login'|'register'|'verify'>('login');
 const [phone,setPhone]=useState('');
 const [notice,setNotice]=useState('');
 useEffect(()=>{if(!session)return;const timer=setTimeout(()=>{setSession(null);setNotice('انتهت الجلسة، يرجى تسجيل الدخول مجدداً.');},Math.max(0,session.expiresAt-Date.now()));return()=>clearTimeout(timer);},[session]);
 async function submit(e:FormEvent<HTMLFormElement>){
 e.preventDefault();if(busy)return;const form=e.currentTarget;const data=new FormData(form);setBusy(true);setNotice('');
 try{
 const path=mode==='login'?'/api/auth/login':'/api/auth/patient-phone';
 const payload=mode==='login'?{phone,password:data.get('password')}:mode==='register'?{action:'start',phone,fullName:data.get('fullName'),age:Number(data.get('age')),governorate:data.get('governorate'),password:data.get('password')}:{action:'verify',phone,code:data.get('code')};
 const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),cache:'no-store'});
 form.reset();
 if(!response.ok){setNotice(response.status===429?'محاولات كثيرة، حاول لاحقاً.':response.status===401?'بيانات الدخول غير صحيحة.':'تسجيل الدخول غير متاح حالياً.');return;}
 if(mode==='register'){setMode('verify');setNotice('أدخل رمز التحقق المرسل إلى واتساب.');return;}
 const login=await response.json();
 const res=await fetch('/api/profile/me',{headers:{Authorization:'Bearer '+login.access_token},cache:'no-store'});
 if(!res.ok){setNotice('تعذر التحقق من الحساب.');return;}
 const profile=await res.json();
 if(profile.role!=='patient'||profile.approval_status!=='approved'){setNotice('تعذر تأكيد تفعيل حساب المراجع أو أن الحساب موقوف.');return;}
 setSession({token:login.access_token,name:profile.full_name??'المراجع',expiresAt:Date.now()+Math.min(login.expires_in,3600)*1000});
 }catch{setNotice('تعذر الاتصال. حاول مجدداً.');}finally{form.reset();setBusy(false);}
 }
 async function signOut(){if(!session)return;const token=session.token;setSession(null);setNotice('تم إنهاء الجلسة المحلية.');try{const res=await fetch('/api/auth/logout',{method:'POST',headers:{Authorization:'Bearer '+token},cache:'no-store'});if(!res.ok)setNotice('تم الخروج محلياً، تعذر تأكيد إنهاء الجلسة على الخادم.');}catch{setNotice('تم الخروج محلياً، تعذر تأكيد إنهاء الجلسة على الخادم.');}}
 if(session)return <><p>أهلاً {session.name}</p><button onClick={signOut}>خروج</button><FeaturePanel token={session.token} role="patient"/><Directory token={session.token}/><Appointments token={session.token}/></>;
 return <article><h2>{mode==='register'?'إنشاء حساب مراجع':mode==='verify'?'تأكيد رقم واتساب':'تسجيل دخول المراجع'}</h2><p>نسخة اختبارية — لا تستخدم بيانات حقيقية. يتفعّل الحساب الجديد بعد تأكيد الرقم دون موافقة الإدارة.</p><form key={mode} onSubmit={submit} className="login-form">
 {mode==='register'&&<><label htmlFor="fullName">الاسم الكامل</label><input id="fullName" name="fullName" minLength={3} maxLength={120} required/><label htmlFor="age">العمر</label><input id="age" name="age" type="number" min={1} max={120} step={1} required/><label htmlFor="governorate">المحافظة</label><select id="governorate" name="governorate" required defaultValue=""><option value="">اختر المحافظة</option>{['بغداد','النجف','كربلاء','بابل','القادسية','المثنى','ذي قار','ميسان','البصرة','واسط','ديالى','صلاح الدين','الأنبار','نينوى','كركوك','أربيل','دهوك','السليمانية','حلبجة'].map(g=><option key={g}>{g}</option>)}</select></>}
 <label htmlFor="phone">رقم الهاتف</label><input id="phone" name="phone" type="tel" inputMode="numeric" value={phone} onChange={e=>setPhone(e.target.value)} maxLength={11} pattern="07[0-9]{9}" required disabled={busy||mode==='verify'}/>
 {mode==='verify'?<><label htmlFor="code">رمز التحقق</label><input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" required disabled={busy}/></>:<><label htmlFor="password">كلمة المرور</label><input id="password" name="password" type="password" autoComplete={mode==='register'?'new-password':'current-password'} minLength={mode==='register'?12:1} maxLength={128} required disabled={busy}/></>}
 <button type="submit" disabled={busy}>{busy?'جارٍ التحقق':mode==='register'?'إرسال رمز واتساب':mode==='verify'?'تأكيد الرقم والدخول':'تسجيل الدخول'}</button></form><button type="button" disabled={busy} onClick={()=>{setMode(mode==='login'?'register':'login');setNotice('');}}>{mode==='login'?'إنشاء حساب جديد':'لدي حساب بالفعل'}</button><p role="status">{notice}</p></article>;
}
