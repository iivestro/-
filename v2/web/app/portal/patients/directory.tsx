'use client';
import {useState} from 'react';
type Item={id:string;name?:string;city?:string;address?:string;qualification?:string;experience_years?:number;consultation_fee?:number};
export default function Directory({token}:{token:string}){
 const [kind,setKind]=useState<'doctors'|'centers'>('doctors');
 const [items,setItems]=useState<Item[]>([]);
 const [next,setNext]=useState<string|null>(null);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 async function load(type:'doctors'|'centers',after?:string){
 if(busy)return;setBusy(true);setMessage('');setKind(type);
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
 return <section><h2>دليل الخدمات الطبية</h2><button disabled={busy} onClick={()=>load('doctors')}>الأطباء</button> <button disabled={busy} onClick={()=>load('centers')}>المراكز الطبية</button><p role="status">{busy?'جارٍ التحميل':message}</p><div className="grid">{items.map(item=><article key={item.id}><h3>{item.name??item.qualification??'طبيب'}</h3><p>{item.city} {item.address}</p>{item.experience_years!=null&&<p>الخبرة: {item.experience_years} سنة</p>}{item.consultation_fee!=null&&<p>الأجور: {item.consultation_fee} د.ع</p>}</article>)}</div>{next&&<button disabled={busy} onClick={()=>load(kind,next)}>عرض المزيد</button>}</section>;
}
