import {useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Alert,Pressable,ScrollView,StatusBar,StyleSheet,Text,TextInput,View} from 'react-native';
declare const process: {env:{EXPO_PUBLIC_PATIENT_API_URL?:string}};
const rawBase=process.env.EXPO_PUBLIC_PATIENT_API_URL??'';
function apiOrigin(){try{const u=new URL(rawBase);return u.protocol==='https:'&&!u.username&&!u.password&&u.pathname==='/'&&!u.search&&!u.hash?u.origin:null;}catch{return null;}}
const base=apiOrigin();
type Role='patient'|'doctor'|'medical_center'|'representative'|'home_provider'|'admin';
const portals:{role:Role;title:string;description:string}[]=[
 {role:'patient',title:'المراجع',description:'الأطباء والمراكز وحجوزاتي'},
 {role:'doctor',title:'الطبيب',description:'الدوام والحجوزات'},
 {role:'medical_center',title:'المراكز الطبية',description:'إدارة حجوزات المركز'},
 {role:'representative',title:'المندوبون',description:'مواعيد الزيارات'},
 {role:'home_provider',title:'الرعاية المنزلية',description:'طلبات الخدمات'},
 {role:'admin',title:'الإدارة',description:'الحسابات والصلاحيات'},
];
type Portal=typeof portals[number];
type Session={token:string;name:string;expires:number};
type Row={id?:string;name?:string;full_name?:string;specialty?:string;qualification?:string;experience_years?:number;consultation_fee?:number;city?:string;address?:string;status?:string;approval_status?:string;role?:string;requested_date?:string;appointment_at?:string;scheduled_at?:string;created_at?:string;day_of_week?:number;start_time?:string;end_time?:string;title?:string;message?:string;is_read?:boolean;subscription_expires_at?:string;subscription_fee?:number;is_available?:boolean;unlimited_daily?:boolean;max_daily_patients?:number;visit_date?:string;capacity?:number;is_open?:boolean};
type Page={items:Row[];next:string|null;displayName?:string};
type Tab={title:string;path:string;kind:'doctors'|'centers'|'bookings'|'workspace'|'hours'|'centerDoctors'|'notifications'|'subscription'|'schedule'|'visits'|'adminAccounts'};
const patientTabs:Tab[]=[{title:'الأطباء',path:'/api/directory/doctors',kind:'doctors'},{title:'المراكز الطبية',path:'/api/directory/centers',kind:'centers'},{title:'حجوزات الأطباء',path:'/api/appointments/me?kind=doctor',kind:'bookings'},{title:'حجوزات المراكز',path:'/api/appointments/me?kind=center',kind:'bookings'}];
const states:Record<string,string>={pending:'قيد الانتظار',approved:'مقبول',confirmed:'مؤكد',completed:'مكتمل',cancelled:'ملغى',rejected:'مرفوض',suspended:'موقوف'};
const days=['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
type Decision={id:string;kind:'doctor'|'center';action:'confirm'|'reschedule'|'reject'|'complete'|'cancel';date:string;time:string;reason:string};
type Booking={kind:'doctor'|'center';providerId:string;centerId?:string;date:string;requestId?:string};
function availableDates(rows:Row[]){const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Baghdad',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const field=(key:string)=>parts.find(p=>p.type===key)?.value??'';const start=new Date(field('year')+'-'+field('month')+'-'+field('day')+'T00:00:00Z');return Array.from({length:30},(_,i)=>new Date(start.valueOf()+i*86400000)).filter(d=>rows.some(r=>r.day_of_week===d.getUTCDay())).map(d=>({value:d.toISOString().slice(0,10),label:days[d.getUTCDay()]+' '+d.getUTCDate()+'/'+(d.getUTCMonth()+1)}));}
const sectionTab=(role:Role,kind:'notifications'|'subscription'|'schedule'|'visits',title:string):Tab=>({title,kind,path:'/api/account/overview?section='+kind+'&role='+role});
class HttpError extends Error{constructor(public status:number){super('Request failed');}}
async function request<T>(path:string,token?:string,body?:object,signal?:AbortSignal):Promise<T>{
 if(!base)throw new HttpError(503);
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),12000);
 const abort=()=>controller.abort();if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
 try{
 const res=await fetch(base+path,{method:body?'POST':'GET',headers:{Accept:'application/json',...(body?{'Content-Type':'application/json',Origin:base}:{}),...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:controller.signal});
 if(!res.ok)throw new HttpError(res.status);
 return await res.json() as T;
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
function errorMessage(e:unknown){if(e instanceof HttpError){if(e.status===401)return 'بيانات الدخول غير صحيحة أو انتهت الجلسة.';if(e.status===403)return 'الحساب أو الاشتراك غير مخول لهذه الخدمة.';if(e.status===429)return 'محاولات كثيرة، حاول لاحقاً.';}return 'تعذر الاتصال بالخادم التجريبي. حاول مجدداً.';}
function dateLabel(value?:string){if(!value)return '';const d=new Date(value);return Number.isNaN(d.valueOf())?'':d.toLocaleString('ar-IQ',{timeZone:'Asia/Baghdad'});}
function Button({title,onPress,disabled=false,secondary=false}:{title:string;onPress:()=>void;disabled?:boolean;secondary?:boolean}){return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[s.button,secondary&&s.secondary,disabled&&s.disabled]}><Text style={secondary?s.secondaryText:s.white}>{title}</Text></Pressable>;}
export default function App(){
 const [portal,setPortal]=useState<Portal|null>(null),[session,setSession]=useState<Session|null>(null);
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const [tab,setTab]=useState<Tab|null>(null),[rows,setRows]=useState<Row[]>([]),[next,setNext]=useState<string|null>(null),[search,setSearch]=useState('');
 const [centerId,setCenterId]=useState<string|null>(null);const [booking,setBooking]=useState<Booking|null>(null);const [decision,setDecision]=useState<Decision|null>(null);
 const active=useRef<AbortController|null>(null);
 function cancel(){active.current?.abort();active.current=null;setBusy(false);}
 function clear(){cancel();setSession(null);setPassword('');setEmail('');setRows([]);setNext(null);setTab(null);setSearch('');setCenterId(null);setBooking(null);setDecision(null);}
 useEffect(()=>{if(!session)return;const timer=setTimeout(()=>{clear();setNotice('انتهت الجلسة، سجل الدخول مجدداً.');},Math.max(0,session.expires-Date.now()));return()=>clearTimeout(timer);},[session]);
 useEffect(()=>()=>active.current?.abort(),[]);
 async function logout(){const token=session?.token;clear();setNotice('تم إنهاء الجلسة المحلية.');if(token){try{await request('/api/auth/logout',token,{});}catch{}}}
 function back(){void logout();setPortal(null);setNotice('');}
 async function login(){
 if(busy||!portal||!base||!email.trim()||!password)return;
 const ctl=new AbortController();active.current=ctl;setBusy(true);setNotice('');
 try{
 const result=await request<{access_token:string;expires_in:number}>('/api/auth/login',undefined,{email:email.trim(),password},ctl.signal);
 if(typeof result.access_token!=='string'||!Number.isFinite(result.expires_in)||result.expires_in<=0)throw new HttpError(503);
 let name=portal.title;
 if(portal.role==='home_provider'){const p=await request<Page>('/api/provider/workspace?kind=home_provider',result.access_token,undefined,ctl.signal);name=p.displayName??name;}
 else{const p=await request<{full_name?:string;role:string;approval_status:string}>('/api/profile/me',result.access_token,undefined,ctl.signal);if(p.role!==portal.role||p.approval_status!=='approved')throw new HttpError(403);name=p.full_name??name;}
 if(ctl.signal.aborted)return;
 setSession({token:result.access_token,name,expires:Date.now()+Math.min(result.expires_in,3600)*1000});
 }catch(e){if(!ctl.signal.aborted)setNotice(errorMessage(e));}finally{if(active.current===ctl){setPassword('');setBusy(false);active.current=null;}}
 }
 async function load(selected:Tab,more?:string){
 if(busy||!session)return;const ctl=new AbortController();active.current=ctl;setBusy(true);setNotice('');setTab(selected);
 if(!more){setRows([]);setNext(null);setSearch('');setDecision(null);if(selected.kind!=='hours')setBooking(null);}
 try{const path=selected.path+(more?(selected.path.includes('?')?'&':'?')+'after='+encodeURIComponent(more):'');
 const data=await request<Page>(path,session.token,undefined,ctl.signal);
 if(ctl.signal.aborted)return;if(!Array.isArray(data.items))throw new HttpError(503);
 setRows(old=>more?[...old,...data.items]:data.items);setNext(data.next??null);if(!data.items.length&&!more)setNotice('لا توجد بيانات متاحة في البيئة المتصلة حالياً.');
 }catch(e){if(!ctl.signal.aborted){if(e instanceof HttpError&&e.status===401){clear();setNotice('انتهت الجلسة، سجل الدخول مجدداً.');}else setNotice(errorMessage(e));}}finally{if(active.current===ctl){setBusy(false);active.current=null;}}
 }
 function details(item:Row){if(!item.id||!tab)return;const id=encodeURIComponent(item.id);
 if(tab.kind==='centers'){setCenterId(item.id);void load({title:item.name??'أطباء المركز',path:'/api/directory/details?kind=center&id='+id,kind:'centerDoctors'});}
 else if(tab.kind==='centerDoctors'&&centerId){setBooking({kind:'center',providerId:item.id,centerId,date:''});void load({title:'دوام '+(item.full_name??'الطبيب'),path:'/api/directory/details?kind=center-doctor&id='+id+'&centerId='+encodeURIComponent(centerId),kind:'hours'});}
 else if(tab.kind==='doctors'){setBooking({kind:'doctor',providerId:item.id,date:''});void load({title:'دوام '+(item.name??'الطبيب'),path:'/api/directory/details?kind=doctor&id='+id,kind:'hours'});}
 }
 async function submitBooking(){
 if(!booking?.date||!session||busy)return;
 const ctl=new AbortController();active.current=ctl;setBusy(true);setNotice('');
 try{
 let key=booking.requestId;
 if(!key){const result=await request<{requestId:string;writesEnabled:boolean}>('/api/appointments/request',session.token,undefined,ctl.signal);if(!result.writesEnabled){setNotice('الحجز غير مفعل بعد في بيئة الاختبار؛ لم يُرسل أي طلب.');return;}key=result.requestId;if(typeof key!=='string')throw new HttpError(503);if(ctl.signal.aborted)return;setBooking({...booking,requestId:key});}
 await request('/api/appointments/request',session.token,{...booking,requestId:key},ctl.signal);
 if(!ctl.signal.aborted){setNotice('تم إرسال طلب الحجز. سيحدد الطبيب ساعة الحضور بعد الموافقة.');setBooking(null);}
 }catch(e){if(!ctl.signal.aborted){if(e instanceof HttpError&&e.status===409)setNotice('قد يكون الطلب مسجلاً مسبقاً. راجع حجوزاتك قبل إعادة المحاولة.');else if(e instanceof HttpError&&e.status===422)setNotice('اليوم غير متاح أو العدد مكتمل. اختر يوماً آخر.');else setNotice(errorMessage(e));}}finally{if(active.current===ctl){setBusy(false);active.current=null;}}
 }
 function chooseDecision(item:Row,action:Decision['action']){
 if(!item.id||!portal||!tab)return;
 setDecision({id:item.id,kind:portal.role==='medical_center'||tab.path.includes('kind=center')?'center':'doctor',action,date:item.requested_date??'',time:'',reason:''});setNotice('');
 }
 async function submitDecision(){
 if(!session||!decision||!tab||busy)return;
 const ctl=new AbortController();active.current=ctl;setBusy(true);setNotice('');
 try{await request('/api/appointments/decision',session.token,decision,ctl.signal);if(ctl.signal.aborted)return;const data=await request<Page>(tab.path,session.token,undefined,ctl.signal);if(ctl.signal.aborted)return;setRows(data.items);setNext(data.next??null);setDecision(null);setNotice('تم تحديث الموعد.');}
 catch(e){if(!ctl.signal.aborted)setNotice(e instanceof HttpError&&e.status===422?'تعذر تنفيذ الإجراء: تحقق من الموعد والدوام والسعة.':errorMessage(e));}
 finally{if(active.current===ctl){active.current=null;setBusy(false);}}
 }
 async function updateAccount(item:Row,status:string){
 if(!session||portal?.role!=='admin'||!item.id||!tab||tab.kind!=='adminAccounts'||busy)return;
 const ctl=new AbortController();active.current=ctl;setBusy(true);setNotice('');
 try{await request('/api/admin/accounts',session.token,{id:item.id,role:item.role,status},ctl.signal);if(!ctl.signal.aborted){setRows(old=>old.map(r=>r.id===item.id?{...r,approval_status:status}:r));setNotice('تم تحديث الحساب. حدّث القائمة لعرض الفلتر الحالي.');}}
 catch(e){if(!ctl.signal.aborted)setNotice(e instanceof HttpError&&e.status===503?'تعديل الحسابات غير مفعل في بيئة الاختبار. لم يتم تأكيد أي تغيير.':errorMessage(e));}
 finally{if(active.current===ctl){active.current=null;setBusy(false);}}
 }
 function confirmAccount(item:Row,status:string){Alert.alert('تأكيد تغيير حالة الحساب',(item.full_name??'الحساب')+' — '+(states[status]??status),[{text:'إلغاء',style:'cancel'},{text:'تأكيد',onPress:()=>void updateAccount(item,status)}]);}
 const allDates=()=>availableDates(days.map((_,day_of_week)=>({day_of_week})));
 const filtered=rows.filter(r=>!search||[r.name,r.full_name,r.specialty,r.city,r.address,r.qualification].some(v=>v?.toLowerCase().includes(search.trim().toLowerCase())));
 return <View style={s.root}><StatusBar barStyle="dark-content"/><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.page}>
 <View style={s.hero}><Text style={s.brand}>PATIENT | بيشنت</Text><Text style={s.white}>رعاية صحية رقمية • 2.0</Text></View>
 {!portal?<><Text style={s.heading}>اختر بوابتك</Text><Text style={s.muted}>تطبيق Native جديد، متصل بخادم النسخة الجديدة عند تهيئته. لا تستخدم بيانات طبية حقيقية في المعاينة.</Text>{portals.map(p=><Pressable key={p.role} accessibilityRole="button" style={s.card} onPress={()=>{setPortal(p);setNotice('');}}><Text style={s.title}>{p.title}</Text><Text style={s.muted}>{p.description}</Text><Text style={s.link}>دخول ←</Text></Pressable>)}</>:<>
 <Button title="العودة إلى البوابات" onPress={back} secondary/>
 <Text style={s.heading}>{portal.title}</Text>
 {!base?<View style={s.card}><Text style={s.title}>الخادم التجريبي غير مهيأ</Text><Text style={s.muted}>اضبط EXPO_PUBLIC_PATIENT_API_URL على عنوان HTTPS الخاص بخادم PATIENT 2.0. لم يتم نقل بيانات المنصة الأصلية إلى هذه البيئة.</Text></View>:!session?<View style={s.card}><Text style={s.title}>تسجيل الدخول</Text><Text style={s.muted}>حساب تجريبي مصرح به فقط</Text><Text style={s.label}>البريد الإلكتروني</Text><TextInput style={s.input} accessibilityLabel="البريد الإلكتروني" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" value={email} onChangeText={setEmail} editable={!busy} maxLength={254}/><Text style={s.label}>كلمة المرور</Text><TextInput style={s.input} accessibilityLabel="كلمة المرور" secureTextEntry autoCapitalize="none" value={password} onChangeText={setPassword} editable={!busy} maxLength={1024}/><Button title={busy?'جارٍ التحقق':'دخول'} onPress={()=>void login()} disabled={busy}/></View>:<>
 <View style={s.card}><Text style={s.title}>أهلاً {session.name}</Text><Button title="خروج" onPress={()=>void logout()} secondary/></View>
 {portal.role==='patient'?<View style={s.tabs}>{patientTabs.map(t=><Button key={t.path} title={t.title} onPress={()=>{setCenterId(null);void load(t);}} disabled={busy} secondary={tab?.path!==t.path}/>)}</View>:<Button title={portal.role==='admin'?'جميع الحسابات':'عرض الطلبات والحجوزات'} onPress={()=>void load(portal.role==='admin'?{title:'جميع الحسابات',path:'/api/admin/accounts',kind:'adminAccounts'}:{title:'لوحة العمل',path:'/api/provider/workspace?kind='+portal.role,kind:'workspace'})} disabled={busy}/>}
 {portal.role==='admin'&&<View style={s.tabs}>{([{role:'patient',label:'المراجعون'},{role:'representative',label:'المندوبون'},{role:'doctor',label:'الأطباء'},{role:'medical_center',label:'المراكز الطبية'}]).map(r=><Button key={r.role} title={r.label} secondary disabled={busy} onPress={()=>void load({title:r.label,path:'/api/admin/accounts?role='+r.role,kind:'adminAccounts'})}/>)}
 <Button title="طلبات الموافقة" secondary disabled={busy} onPress={()=>void load({title:'طلبات الموافقة',path:'/api/admin/accounts?status=pending',kind:'adminAccounts'})}/></View>}
 <View style={s.tabs}><Button title="الإشعارات" disabled={busy} secondary onPress={()=>void load(sectionTab(portal.role,'notifications','الإشعارات'))}/>{['doctor','medical_center','representative','home_provider'].includes(portal.role)&&<Button title="اشتراكي" disabled={busy} secondary onPress={()=>void load(sectionTab(portal.role,'subscription','الاشتراك'))}/>}
 {portal.role==='doctor'&&<Button title="جدول دوامي" disabled={busy} secondary onPress={()=>void load(sectionTab(portal.role,'schedule','جدول الدوام'))}/>}
 {['doctor','representative'].includes(portal.role)&&<Button title="مواعيد زيارات المندوبين" disabled={busy} secondary onPress={()=>void load(sectionTab(portal.role,'visits','مواعيد الزيارات'))}/>}</View>
 {tab&&<><Text style={s.heading}>{tab.title}</Text>{['doctors','centers','centerDoctors','adminAccounts'].includes(tab.kind)&&<TextInput style={s.input} accessibilityLabel="البحث في النتائج المحملة" placeholder="بحث في النتائج المحملة" placeholderTextColor="#526970" value={search} onChangeText={setSearch}/>}
 {filtered.map((item,i)=><View key={item.id??i} style={s.card}>
 {tab.kind==='hours'||tab.kind==='schedule'?<><Text style={s.title}>{days[item.day_of_week??-1]??'اليوم'}: {item.start_time?.slice(0,5)} – {item.end_time?.slice(0,5)}</Text>{tab.kind==='schedule'&&<Text style={s.muted}>{item.is_available?'متاح':'مغلق'} • {item.unlimited_daily?'عدد غير محدود':'الحد اليومي: '+(item.max_daily_patients??'—')}</Text>}</>:tab.kind==='notifications'?<><Text style={s.title}>{item.title??'إشعار'}</Text><Text style={s.muted}>{item.message}</Text><Text style={s.muted}>{item.is_read?'مقروء':'جديد'} • {dateLabel(item.created_at)}</Text></>:tab.kind==='subscription'?<><Text style={s.title}>حالة الاشتراك</Text><Text style={s.muted}>الانتهاء: {dateLabel(item.subscription_expires_at)||'غير محدد'}</Text><Text style={s.muted}>الرسوم: {item.subscription_fee??'—'} د.ع</Text></>:tab.kind==='visits'?<><Text style={s.title}>{item.visit_date??'زيارة'}</Text><Text style={s.muted}>{item.start_time?.slice(0,5)} – {item.end_time?.slice(0,5)} • العدد: {item.capacity??'—'}</Text><Text style={s.muted}>{item.is_open?'متاح':'مغلق'}</Text></>:<><Text style={s.title}>{item.name??item.full_name??states[item.status??item.approval_status??'']??item.role??'سجل'}</Text>{item.specialty&&<Text style={s.muted}>{item.specialty}</Text>}{item.qualification&&<Text style={s.muted}>{item.qualification}</Text>}{item.city&&<Text style={s.muted}>{item.city} {item.address}</Text>}{item.consultation_fee!=null&&<Text style={s.muted}>الأجور: {item.consultation_fee} د.ع</Text>}{item.requested_date&&<Text style={s.muted}>اليوم المطلوب: {item.requested_date}</Text>}{(item.appointment_at||item.scheduled_at)&&<Text style={s.muted}>الموعد: {dateLabel(item.appointment_at??item.scheduled_at)}</Text>}{item.role&&<Text style={s.muted}>الدور: {item.role}</Text>}{item.approval_status&&<Text style={s.muted}>الحالة: {states[item.approval_status]??item.approval_status}</Text>}{tab.kind==='adminAccounts'&&item.created_at&&<Text style={s.muted}>التسجيل: {dateLabel(item.created_at)}</Text>}{tab.kind==='adminAccounts'&&['patient','representative'].includes(item.role??'')&&<View style={s.dateGrid}>{['approved','rejected','suspended'].filter(st=>st!==item.approval_status).map(st=><Button key={st} title={states[st]} disabled={busy} secondary onPress={()=>confirmAccount(item,st)}/>)}</View>}{['doctors','centers','centerDoctors'].includes(tab.kind)&&<Button title={tab.kind==='centers'?'عرض أطباء المركز':'عرض الدوام'} onPress={()=>details(item)} disabled={busy} secondary/>}
 {tab.kind==='bookings'&&['pending','approved','confirmed'].includes(item.status??'')&&<Button title="إلغاء الطلب" secondary disabled={busy} onPress={()=>chooseDecision(item,'cancel')}/>}
 {tab.kind==='workspace'&&['doctor','medical_center'].includes(portal.role)&&item.status==='pending'&&<><Button title="قبول وتحديد الموعد" disabled={busy} onPress={()=>chooseDecision(item,'confirm')}/><Button title="رفض الحجز" secondary disabled={busy} onPress={()=>chooseDecision(item,'reject')}/></>}
 {tab.kind==='workspace'&&['doctor','medical_center'].includes(portal.role)&&['approved','confirmed'].includes(item.status??'')&&<><Button title="تعديل الموعد" secondary disabled={busy} onPress={()=>chooseDecision(item,'reschedule')}/><Button title="إكمال الزيارة" secondary disabled={busy} onPress={()=>chooseDecision(item,'complete')}/></>}
 </>}
 </View>)}{next&&<Button title="عرض المزيد" onPress={()=>void load(tab,next)} disabled={busy}/>}</>}
 {decision&&<View style={s.card}><Text style={s.title}>{({confirm:'تأكيد الحجز',reschedule:'تعديل الموعد',reject:'رفض الحجز',complete:'إكمال الزيارة',cancel:'إلغاء الحجز'})[decision.action]}</Text>
 {['confirm','reschedule'].includes(decision.action)&&<><Text style={s.label}>يوم الحضور</Text><View style={s.dateGrid}>{allDates().map(d=><Pressable key={d.value} accessibilityRole="button" accessibilityState={{selected:decision.date===d.value}} disabled={busy} onPress={()=>setDecision({...decision,date:d.value})} style={[s.dateTile,decision.date===d.value&&s.dateSelected]}><Text style={decision.date===d.value?s.white:s.secondaryText}>{d.label}</Text></Pressable>)}</View><Text style={s.label}>ساعة الحضور بتوقيت العراق (فواصل 15 دقيقة)</Text><View style={s.dateGrid}>{Array.from({length:96},(_,i)=>String(Math.floor(i/4)).padStart(2,'0')+':'+String((i%4)*15).padStart(2,'0')).map(t=><Pressable key={t} accessibilityRole="button" accessibilityState={{selected:decision.time===t}} disabled={busy} onPress={()=>setDecision({...decision,time:t})} style={[s.dateTile,decision.time===t&&s.dateSelected]}><Text style={decision.time===t?s.white:s.secondaryText}>{t}</Text></Pressable>)}</View><Text style={s.muted}>يتحقق الخادم من الدوام والسعة قبل قبول الموعد.</Text></>}
 {decision.action==='reject'&&<><Text style={s.label}>سبب الرفض</Text><TextInput style={s.input} value={decision.reason} editable={!busy} maxLength={1000} onChangeText={reason=>setDecision({...decision,reason})}/></>}
 <Button title="تأكيد الإجراء" disabled={busy||(['confirm','reschedule'].includes(decision.action)&&(!decision.date||!decision.time))||(decision.action==='reject'&&!decision.reason.trim())} onPress={()=>void submitDecision()}/><Button title="العودة دون تغيير" secondary disabled={busy} onPress={()=>setDecision(null)}/></View>}
 {tab?.kind==='hours'&&booking&&rows.length>0&&<View style={s.card}><Text style={s.title}>اختر يوم المراجعة</Text><Text style={s.muted}>تظهر أيام الدوام خلال 30 يوماً، وليست ضماناً لتوفر السعة. يحدد الطبيب وقت الوصول بعد الموافقة.</Text><View style={s.dateGrid}>{availableDates(rows).map(d=><Pressable key={d.value} accessibilityRole="button" accessibilityState={{selected:booking.date===d.value}} disabled={busy||!!booking.requestId} onPress={()=>setBooking({...booking,date:d.value})} style={[s.dateTile,booking.date===d.value&&s.dateSelected]}><Text style={booking.date===d.value?s.white:s.secondaryText}>{d.label}</Text></Pressable>)}</View>{booking.requestId&&<Text style={s.muted}>الطلب قيد إعادة المحاولة؛ راجع سجل حجوزاتك قبل تغيير اليوم.</Text>}<Button title="إرسال طلب الحجز" disabled={!booking.date||busy} onPress={()=>void submitBooking()}/></View>}
 <Text style={s.muted}>بيئة اختبار: وظائف تعديل البيانات محمية حتى اكتمال التحقق. الإشعارات والاشتراكات والدوام للعرض حالياً.</Text>
 </>}
 </>}
 {busy&&<ActivityIndicator color="#08777e"/>}{notice? <Text accessibilityLiveRegion="polite" style={s.notice}>{notice}</Text>:null}
 </ScrollView></View>;
}
const s=StyleSheet.create({root:{flex:1,paddingTop:55,backgroundColor:'#f3faf9'},page:{padding:18,paddingBottom:48,gap:14},hero:{padding:25,borderRadius:24,backgroundColor:'#08777e',gap:10},brand:{fontSize:26,fontWeight:'700',color:'#fff',textAlign:'right'},white:{fontSize:16,fontWeight:'600',color:'#fff',textAlign:'center'},heading:{fontSize:23,fontWeight:'700',color:'#183f4a',textAlign:'right'},title:{fontSize:19,fontWeight:'700',color:'#183f4a',textAlign:'right'},muted:{fontSize:15,color:'#395b60',textAlign:'right',lineHeight:24},card:{padding:18,backgroundColor:'#fff',borderRadius:18,borderWidth:1,borderColor:'#cfe5e2',gap:10},link:{fontWeight:'600',color:'#086971',textAlign:'right'},label:{fontSize:15,fontWeight:'600',textAlign:'right',color:'#183f4a'},input:{minHeight:48,borderWidth:1,borderColor:'#99c9c7',borderRadius:12,paddingHorizontal:12,backgroundColor:'#fff',color:'#183f4a',fontSize:16,textAlign:'right'},button:{backgroundColor:'#08777e',padding:14,borderRadius:12,minHeight:48,justifyContent:'center'},secondary:{backgroundColor:'#e1efed'},secondaryText:{fontSize:15,fontWeight:'600',color:'#075b62',textAlign:'center'},disabled:{opacity:.5},tabs:{gap:8},dateGrid:{flexDirection:'row',flexWrap:'wrap',gap:8},dateTile:{padding:12,minHeight:48,borderRadius:10,backgroundColor:'#e1efed',justifyContent:'center'},dateSelected:{backgroundColor:'#08777e'},notice:{fontSize:15,color:'#784915',backgroundColor:'#fff3db',borderRadius:10,padding:12,textAlign:'right'}});
