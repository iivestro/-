'use client';
import {useEffect,useRef,useState} from 'react';
import {features,labels,display,type FeatureDefinition} from '../../lib/features';
export default function FeaturePanel({token,role}:{token:string;role:string}){
 const [selected,setSelected]=useState<FeatureDefinition|null>(null),[form,setForm]=useState<Record<string,string>>({}),[result,setResult]=useState<unknown>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const active=useRef<AbortController|null>(null),paymentId=useRef('');
 useEffect(()=>()=>{active.current?.abort();},[token]);
 async function run(action:string,data:Record<string,unknown>={}){
 if(busy)return;setBusy(true);setNotice('');setResult(null);
 const ctl=new AbortController();active.current=ctl;const timer=setTimeout(()=>ctl.abort(),12000);
 try{const r=await fetch('/api/features',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({action,data}),cache:'no-store',signal:ctl.signal});if(!r.ok)throw Error(r.status===503?'الوظائف الجديدة قيد الاختبار ولم تُفعّل بعد.':'تعذر تنفيذ الطلب. تحقق من البيانات والصلاحية.');const json=await r.json();
 const refreshAction:Record<string,string>={support_create:'support_list',support_reply:'support_list',queue_checkin:'queue_provider',queue_update:'queue_provider'};
 const next=refreshAction[action];
 if(next&&!ctl.signal.aborted){
 const feature=features.find(f=>f.action===next&&f.roles.includes(role));
 if(feature){setSelected(feature);setForm({});}
 const refreshed=await fetch('/api/features',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({action:next,data:{}}),cache:'no-store',signal:ctl.signal});
 if(!ctl.signal.aborted){if(refreshed.ok){const fresh=await refreshed.json();setResult(fresh.result);setNotice('تم تنفيذ الطلب.');}else{setNotice('تم تنفيذ الطلب؛ اضغط تحديث لعرض القائمة.');}}
 }else if(!ctl.signal.aborted)setResult(json.result);}
 catch(e){if(!ctl.signal.aborted)setNotice(e instanceof Error?e.message:'تعذر الاتصال.');}
 finally{clearTimeout(timer);if(active.current===ctl){setBusy(false);active.current=null;}}
 }
 function choose(f:FeatureDefinition){setSelected(f);setForm({});setResult(null);setNotice('');paymentId.current='';if(!f.fields)void run(f.action);}
 function submit(){if(!selected)return;const d:Record<string,unknown>={};for(const [key,,type] of selected.fields??[]){const v=form[key]??'';if(type==='optional'&&!v)continue;d[key]=type==='number'?Number(v):type==='datetime-local'?new Date(v).toISOString():v;}
 if(selected.action==='queue_checkin')d.kind=role==='doctor'?'doctor':'center';
 if(selected.action==='payment_record'){if(!paymentId.current)paymentId.current=crypto.randomUUID();d.request_id=paymentId.current;}
 void run(selected.action,d);}
 function locate(){if(!navigator.geolocation){setNotice('الموقع غير متاح.');return;}navigator.geolocation.getCurrentPosition(pos=>{setForm(f=>({...f,latitude:String(pos.coords.latitude),longitude:String(pos.coords.longitude)}));setNotice('تم تحديد الموقع؛ اضغط البحث لإرسال الإحداثيات.');},()=>setNotice('تعذر الحصول على الموقع أو لم تمنح الإذن.'),{enableHighAccuracy:false,timeout:10000,maximumAge:60000});}
 const rows=Array.isArray(result)?result.map(v=>typeof v==='string'?{permission:v}:v):result&&typeof result==='object'?[result]:[];
 return <section className="feature-panel"><h2>الخدمات والإدارة المتقدمة</h2><p>بيئة اختبار. الملف الصحي الحالي سجلات نصية خاصة فقط؛ التنبيهات الخارجية والمشاركة والرفع قيد الإكمال.</p><div className="feature-menu">{features.filter(f=>f.roles.includes(role)).map(f=><button key={f.action} type="button" disabled={busy} onClick={()=>choose(f)}>{f.title}</button>)}</div>
 {selected&&<article><h3>{selected.title}</h3>{selected.fields&&<form className="login-form" onSubmit={e=>{e.preventDefault();submit();}}>{selected.fields.map(([key,label,type])=><div className="feature-field" key={key}><label htmlFor={'f-'+key}>{label}</label>{type?.includes('|')?<select required id={'f-'+key} value={form[key]??''} onChange={e=>setForm(f=>({...f,[key]:e.target.value}))}><option value="">اختر</option>{type.split('|').map(v=><option value={v} key={v}>{display(v)}</option>)}</select>:<input id={'f-'+key} type={type==='date'||type==='datetime-local'||type==='number'?type:'text'} step={type==='number'?'any':undefined} required={type!=='optional'} value={form[key]??''} maxLength={2000} onChange={e=>setForm(f=>({...f,[key]:e.target.value}))}/>}</div>)}{selected.action==='nearby'&&<button type="button" onClick={locate} disabled={busy}>استخدام موقعي بعد إذني</button>}<button disabled={busy} type="submit">{selected.action==='nearby'?'البحث':'تنفيذ'}</button></form>}
 {!selected.fields&&<button disabled={busy} onClick={()=>void run(selected.action)}>تحديث</button>}
 {Array.isArray(result)&&result.length===0&&<p>لا توجد نتائج.</p>}{rows.map((row,i)=><div className="feature-result" key={String(row.id??i)}>{Object.entries(row).filter(([k])=>!['id','booking_id','provider_id'].includes(k)).map(([k,v])=><p key={k}><strong>{labels[k]??k}:</strong> {display(v)}</p>)}
 {selected.action==='support_list'&&['admin','staff'].includes(role)&&row.status==='open'&&<form className="login-form" onSubmit={e=>{e.preventDefault();void run('support_reply',{id:row.id,reply:new FormData(e.currentTarget).get('reply')});}}><label htmlFor={'reply-'+row.id}>رد الإدارة</label><input id={'reply-'+row.id} name="reply" maxLength={2000} required/><button disabled={busy}>إرسال الرد</button></form>}
 {selected.action==='queue_bookings'&&<button disabled={busy} onClick={()=>void run('queue_checkin',{booking_id:row.id,kind:role==='doctor'?'doctor':'center'})}>تسجيل الحضور وإصدار الدور</button>}
 {selected.action==='queue_provider'&&['waiting','called'].includes(String(row.state))&&<>{row.state==='waiting'?<button disabled={busy} onClick={()=>void run('queue_update',{id:row.id,state:'called'})}>نداء المراجع</button>:<button disabled={busy} onClick={()=>void run('queue_update',{id:row.id,state:'completed'})}>إنهاء الدور</button>}<button disabled={busy} onClick={()=>void run('queue_update',{id:row.id,state:'cancelled'})}>إلغاء الدور</button></>}
 {selected.action==='health_list'&&<button disabled={busy} onClick={()=>{if(window.confirm('حذف السجل الصحي؟'))void run('health_delete',{id:row.id});}}>حذف السجل</button>}
 {selected.action==='announcement_admin_list'&&<button disabled={busy} onClick={()=>void run('announcement_publish',{id:row.id,published:!row.published})}>{row.published?'إلغاء النشر':'نشر'}</button>}
 </div>)}</article>}
 <p role="status">{busy?'جارٍ التنفيذ':notice}</p></section>;
}
