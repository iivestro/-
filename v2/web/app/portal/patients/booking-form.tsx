'use client';
import {useState,type FormEvent} from 'react';
export default function BookingForm({token,kind,providerId,centerId}:{token:string;kind:'doctor'|'center';providerId:string;centerId?:string}){
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Baghdad',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const [date,setDate]=useState(today),[requestId,setRequestId]=useState<string|null>(null),[busy,setBusy]=useState(false),[done,setDone]=useState(false),[notice,setNotice]=useState('');
 async function send(e:FormEvent<HTMLFormElement>){e.preventDefault();if(busy||done)return;setBusy(true);setNotice('');
 try{const id=requestId??crypto.randomUUID();setRequestId(id);
 const res=await fetch('/api/appointments/request',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({kind,providerId,centerId,date,requestId:id}),cache:'no-store'});
 if(res.status===201){setDone(true);setNotice('تم إرسال الطلب؛ يحدد مقدم الخدمة ساعة الحضور بعد الموافقة.');}
 else if(res.status===409){setNotice('يوجد طلب متعارض أو سبق تسجيل الطلب. راجع حجوزاتي قبل إعادة المحاولة.');}
 else if(res.status===422){setNotice('اليوم غير متاح أو بلغ الحد اليومي. اختر يوماً آخر.');}
 else if(res.status===503){setNotice('إنشاء الحجوزات غير متاح حالياً في النسخة التجريبية.');}
 else{setNotice('تعذر إرسال الطلب. تحقق من حسابك والتاريخ.');}
 }catch{setNotice('تعذر تأكيد الطلب. راجع حجوزاتي قبل إعادة المحاولة.');}finally{setBusy(false);}
 }
 return <form className="login-form" onSubmit={send}><label>اليوم المطلوب<input type="date" min={today} required value={date} disabled={busy||done} onChange={e=>{setDate(e.target.value);setRequestId(null);setNotice('');}}/></label><p>يحدد الطبيب أو المركز وقت الحضور بعد قبول الطلب.</p><button type="submit" disabled={busy||done}>{busy?'جارٍ الإرسال':done?'تم الإرسال':'إرسال طلب الحجز التجريبي'}</button><p role="status">{notice}</p></form>;
}
