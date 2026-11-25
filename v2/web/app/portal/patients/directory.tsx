'use client';
import {useState} from 'react';
type Item={id:string;name?:string;city?:string;address?:string;qualification?:string;specialty?:string;experience_years?:number;consultation_fee?:number};
type Detail={id?:string;full_name?:string;specialty?:string;day_of_week?:number;start_time?:string;end_time?:string};
const days=['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
export default function Directory({token}:{token:string}){
 const [kind,setKind]=useState<'doctors'|'centers'>('doctors');
 const [items,setItems]=useState<Item[]>([]);
 const [next,setNext]=useState<string|null>(null);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 const [selected,setSelected]=useState<Item|null>(null);
 const [details,setDetails]=useState<Detail[]>([]);
 const [detailNext,setDetailNext]=useState<string|null>(null);
 async function load(type:'doctors'|'centers',after?:string){
 if(busy)return;setBusy(true);setMessage('');setKind(type);setSelected(null);setDetails([]);setDetailNext(null);
 if(!after){setItems([]);setNext(null);}
 try{
 const params=new URLSearchParams();if(after)params.set('after',after);
 const res=await fetch('/api/directory/'+type+'?'+params,{headers:{Authorization:'Bearer '+token},cache:'no-store'});
 if(!res.ok)throw new Error('request failed');
 const data=await res.json() as {items:Item[];next:string|null};
 setItems(old=>after?[...old,...data.items]:data.items);setNext(data.next);
 if(!data.items.length)setMessage('لا توجد نتائج إضافية.');
 }catch{setMessage('تعذر تحميل الدليل. يرجى المحاولة مجدداً.');}finally{setBusy(false);}
 }
 async function detail(item:Item,after?:string){
 if(busy)return;setBusy(true);setMessage('');setSelected(item);if(!after){setDetails([]);setDetailNext(null);}
 try{
 const params=new URLSearchParams({id:item.id,kind:kind==='doctors'?'doctor':'center'});if(after)params.set('after',after);
 const res=await fetch('/api/directory/details?'+params,{headers:{Authorization:'Bearer '+token},cache:'no-store'});
 if(!res.ok)throw new Error('request failed');
 const data=await res.json() as {items:Detail[];next:string|null};
 setDetails(old=>after?[...old,...data.items]:data.items);setDetailNext(data.next);
 if(!data.items.length)setMessage('لا توجد تفاصيل إضافية.');
 }catch{setMessage('تعذر تحميل التفاصيل.');}finally{setBusy(false);}
 }
 return <section><h2>دليل الخدمات الطبية</h2><button disabled={busy} onClick={()=>load('doctors')}>الأطباء</button> <button disabled={busy} onClick={()=>load('centers')}>المراكز الطبية</button><p role="status">{busy?'جارٍ التحميل':message}</p>{selected?<article><button disabled={busy} onClick={()=>{setSelected(null);setMessage('');}}>العودة إلى الدليل</button><h3>{selected.name??selected.qualification??'الطبيب'}</h3><h4>{kind==='doctors'?'أوقات الدوام بتوقيت العراق':'أطباء المركز'}</h4>{details.map((d,i)=><article key={d.id??i}>{kind==='doctors'?<p>{days[d.day_of_week??-1]??'غير محدد'}: {d.start_time?.slice(0,5)} – {d.end_time?.slice(0,5)}</p>:<><h4>{d.full_name}</h4><p>{d.specialty}</p></>}</article>)}{detailNext&&<button disabled={busy} onClick={()=>detail(selected,detailNext)}>عرض المزيد</button>}</article>:<><div className="grid">{items.map(item=><article key={item.id}><h3>{item.name??item.qualification??'طبيب'}</h3><p>{item.specialty} {item.city} {item.address}</p>{item.experience_years!=null&&<p>الخبرة: {item.experience_years} سنة</p>}{item.consultation_fee!=null&&<p>الأجور: {item.consultation_fee} د.ع</p>}<button disabled={busy} onClick={()=>detail(item)}>{kind==='doctors'?'أوقات الدوام':'أطباء المركز'}</button></article>)}</div>{next&&<button disabled={busy} onClick={()=>load(kind,next)}>عرض المزيد</button>}</>}</section>;
}
