'use client';
import {useState,useEffect,type FormEvent} from 'react';
type Role='doctor'|'medical_center'|'representative'|'admin'|'home_provider';
type Row={id:string;status?:string;role?:string;approval_status?:string;requested_date?:string;appointment_at?:string;created_at?:string;scheduled_at?:string};
const names:Record<Role,string>={doctor:'الطبيب',medical_center:'المركز الطبي',representative:'المندوب',admin:'الإدارة',home_provider:'الرعاية المنزلية'};
const statuses:Record<string,string>={pending:'قيد الانتظار',approved:'مقبول',confirmed:'مؤكد',cancelled:'ملغى',completed:'مكتمل',rejected:'مرفوض',suspended:'موقوف'};
export default function Workspace({role}:{role:Role}){
 const [session,setSession]=useState<{token:string;name:string;expiresAt:number}|null>(null);
 const [items,setItems]=useState<Row[]>([]),[next,setNext]=useState<string|null>(null);
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 useEffect(()=>{if(!session)return;const timer=setTimeout(()=>{setSession(null);setItems([]);setNext(null);setNotice('انتهت الجلسة.');},Math.max(0,session.expiresAt-Date.now()));return()=>clearTimeout(timer);},[session]);
 async function login(e:FormEvent<HTMLFormElement>){e.preventDefault();if(busy)return;setBusy(true);setNotice('');const form=e.currentTarget;const data=new FormData(form);
 try{const res=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:data.get('email'),password:data.get('password')}),cache:'no-store'});
 if(!res.ok)throw new Error('Login failed');const login=await res.json();
 if(role==='home_provider'){
 const check=await fetch('/api/provider/workspace?kind=home_provider',{headers:{Authorization:'Bearer '+login.access_token},cache:'no-store'});
 if(!check.ok){setNotice('حساب الرعاية المنزلية أو الاشتراك غير فعال.');return;}
 const result=await check.json();setSession({token:login.access_token,name:result.displayName??names[role],expiresAt:Date.now()+Math.min(login.expires_in,3600)*1000});setItems(result.items);setNext(result.next);return;
 }
 const profile=await fetch('/api/profile/me',{headers:{Authorization:'Bearer '+login.access_token},cache:'no-store'});if(!profile.ok)throw new Error('Profile failed');
 const user=await profile.json();if(user.role!==role||user.approval_status!=='approved'){setNotice('الحساب غير مخول لهذه البوابة.');return;}
 setSession({token:login.access_token,name:user.full_name??names[role],expiresAt:Date.now()+Math.min(login.expires_in,3600)*1000});setItems([]);setNext(null);
 }catch{setNotice('تعذر تسجيل الدخول. تحقق من الحساب أو حاول لاحقاً.');}finally{form.reset();setBusy(false);}
 }
 async function load(after?:string){if(!session||busy)return;setBusy(true);setNotice('');if(!after){setItems([]);setNext(null);}
 try{const params=new URLSearchParams({kind:role});if(after)params.set('after',after);
 const res=await fetch('/api/provider/workspace?'+params,{headers:{Authorization:'Bearer '+session.token},cache:'no-store'});if(!res.ok){setNotice(res.status===403?'الحساب أو الاشتراك غير فعال.':'تعذر تحميل البيانات.');return;}
 const data=await res.json() as {items:Row[];next:string|null};setItems(old=>after?[...old,...data.items]:data.items);setNext(data.next);if(!data.items.length)setNotice('لا توجد نتائج.');
 }catch{setNotice('تعذر الاتصال.');}finally{setBusy(false);}
 }
 async function logout(){if(!session||busy)return;const token=session.token;setSession(null);setItems([]);setNext(null);setNotice('تم إنهاء الجلسة المحلية.');try{const res=await fetch('/api/auth/logout',{method:'POST',headers:{Authorization:'Bearer '+token},cache:'no-store'});if(!res.ok)setNotice('تم الخروج محلياً؛ تعذر تأكيد الخروج من الخادم.');}catch{setNotice('تم الخروج محلياً؛ تعذر تأكيد الخروج من الخادم.');}}
 if(!session)return <article><h2>تسجيل دخول {names[role]}</h2><p>نسخة تجريبية — استخدم حساباً وهمياً فقط.</p><form className="login-form" onSubmit={login}><label htmlFor="workspace-email">البريد الإلكتروني</label><input id="workspace-email" name="email" type="email" autoComplete="username" maxLength={254} required disabled={busy}/><label htmlFor="workspace-password">كلمة المرور</label><input id="workspace-password" name="password" type="password" autoComplete="current-password" maxLength={1024} required disabled={busy}/><button type="submit" disabled={busy}>دخول</button></form><p role="status">{notice}</p></article>;
 return <section><h2>أهلاً {session.name}</h2><p>واجهة قراءة تجريبية؛ التعديل والإدارة غير مفعّلين بعد.</p><button disabled={busy} onClick={logout}>خروج</button> <button disabled={busy} onClick={()=>load()}>{role==='admin'?'عرض الحسابات':role==='home_provider'?'عرض الطلبات':'عرض الحجوزات'}</button><p role="status">{busy?'جارٍ التحميل':notice}</p><div className="grid">{items.map(item=><article key={item.id}><h3>{statuses[item.status??item.approval_status??'']??'حالة غير محددة'}</h3>{item.role&&<p>الدور: {item.role}</p>}{item.requested_date&&<p>اليوم المطلوب: {item.requested_date}</p>}{item.appointment_at&&<p>الحضور: {new Date(item.appointment_at).toLocaleString('ar-IQ',{timeZone:'Asia/Baghdad'})}</p>}{item.scheduled_at&&<p>موعد الزيارة: {new Date(item.scheduled_at).toLocaleString('ar-IQ',{timeZone:'Asia/Baghdad'})}</p>}{item.created_at&&<p>تاريخ التسجيل: {new Date(item.created_at).toLocaleDateString('ar-IQ',{timeZone:'Asia/Baghdad'})}</p>}</article>)}</div>{next&&<button disabled={busy} onClick={()=>load(next)}>عرض المزيد</button>}</section>;
}
