'use client';
import {useState} from 'react';
type Booking={id:string;status:string;requested_date:string|null;appointment_at:string|null};
const statuses:Record<string,string>={pending:'بانتظار الموافقة',approved:'مقبول',confirmed:'مؤكد',cancelled:'ملغى',completed:'مكتمل',rejected:'مرفوض'};
export default function Appointments({token}:{token:string}){
 const [kind,setKind]=useState<'doctor'|'center'>('doctor');
 const [items,setItems]=useState<Booking[]>([]);
 const [next,setNext]=useState<string|null>(null);
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 async function load(type:'doctor'|'center',after?:string){
 if(busy)return;setBusy(true);setNotice('');setKind(type);if(!after){setItems([]);setNext(null);}
 try{const params=new URLSearchParams({kind:type});if(after)params.set('after',after);
 const res=await fetch('/api/appointments/me?'+params,{headers:{Authorization:'Bearer '+token},cache:'no-store'});
 if(!res.ok)throw new Error('Failed');
 const data=await res.json() as {items:Booking[];next:string|null};
 setItems(old=>after?[...old,...data.items]:data.items);setNext(data.next);
 if(!data.items.length)setNotice('لا توجد حجوزات إضافية.');
 }catch{setNotice('تعذر تحميل الحجوزات.');}finally{setBusy(false);}
 }
 return <section><h2>حجوزاتي</h2><button disabled={busy} onClick={()=>load('doctor')}>حجوزات الأطباء</button> <button disabled={busy} onClick={()=>load('center')}>حجوزات المراكز</button><p role="status">{busy?'جارٍ التحميل':notice}</p><div className="grid">{items.map(item=><article key={item.id}><h3>{statuses[item.status]??'حالة غير معروفة'}</h3><p>اليوم المطلوب: {item.requested_date??'غير محدد'}</p><p>موعد الحضور: {item.appointment_at?new Date(item.appointment_at).toLocaleString('ar-IQ',{timeZone:'Asia/Baghdad'}):'لم يحدد بعد'}</p></article>)}</div>{next&&<button disabled={busy} onClick={()=>load(kind,next)}>عرض المزيد</button>}</section>;
}
