import {useEffect,useRef,useState} from 'react';
import EmergencyChat from './EmergencyChat';
import FeaturePanel from './FeaturePanel';
import {ActivityIndicator,Alert,Pressable,ScrollView,StatusBar,StyleSheet,Text,TextInput,View} from 'react-native';
declare const process: {env:{EXPO_PUBLIC_PATIENT_API_URL?:string}};
const rawBase=process.env.EXPO_PUBLIC_PATIENT_API_URL??'';
function apiOrigin(){try{const u=new URL(rawBase);return u.protocol==='https:'&&!u.username&&!u.password&&u.pathname==='/'&&!u.search&&!u.hash?u.origin:null;}catch{return null;}}
const base=apiOrigin();
type Role='patient'|'doctor'|'medical_center'|'representative'|'home_provider'|'admin'|'staff';
const portals:{role:Role;title:string;description:string}[]=[
 {role:'patient',title:'المراجع',description:'الأطباء والمراكز وحجوزاتي'},
 {role:'doctor',title:'الطبيب',description:'الدوام والحجوزات'},
 {role:'medical_center',title:'المراكز الطبية',description:'إدارة حجوزات المركز'},
 {role:'representative',title:'المندوبون',description:'مواعيد الزيارات'},
 {role:'home_provider',title:'الرعاية المنزلية',description:'طلبات الخدمات'},
 {role:'staff',title:'الموظفون',description:'المهام الإدارية حسب الصلاحية'},
 {role:'admin',title:'الإدارة',description:'الحسابات والصلاحيات'},
];
type Portal=typeof portals[number];
type Session={token:string;name:string;expires:number};
type Row={id?:string;name?:string;full_name?:string;specialty?:string;qualification?:string;experience_years?:number;consultation_fee?:number;city?:string;address?:string;status?:string;approval_status?:string;role?:string;requested_date?:string;appointment_at?:string;scheduled_at?:string;created_at?:string;day_of_week?:number;start_time?:string;end_time?:string;title?:string;message?:string;is_read?:boolean;subscription_expires_at?:string;subscription_fee?:number;is_available?:boolean;unlimited_daily?:boolean;max_daily_patients?:number;visit_date?:string;capacity?:number;is_open?:boolean;display_name?:string;governorate?:string;kind?:string;gender?:string;quoted_price?:number;employer_name?:string;employer_type?:string;is_active?:boolean;occurred_at?:string;actor_id?:string;entity?:string;entity_key?:string;operation?:string;before_state?:Record<string,unknown>;after_state?:Record<string,unknown>};
type Page={items:Row[];next:string|null;displayName?:string};
type Tab={title:string;path:string;kind:'doctors'|'centers'|'bookings'|'workspace'|'hours'|'centerDoctors'|'notifications'|'subscription'|'schedule'|'visits'|'adminAccounts'|'homeDirectory'|'homeRequests'|'doctorVisits'|'adminDoctors'|'adminCenters'|'adminReps'|'audit'};
const patientTabs:Tab[]=[{title:'الأطباء',path:'/api/directory/doctors',kind:'doctors'},{title:'المراكز الطبية',path:'/api/directory/centers',kind:'centers'},{title:'حجوزات الأطباء',path:'/api/appointments/me?kind=doctor',kind:'bookings'},{title:'حجوزات المراكز',path:'/api/appointments/me?kind=center',kind:'bookings'}];
const states:Record<string,string>={quoted:'بانتظار قبول العرض',en_route:'في الطريق',arrived:'وصل مقدم الخدمة',pending:'قيد الانتظار',approved:'مقبول',confirmed:'مؤكد',completed:'مكتمل',cancelled:'ملغى',rejected:'مرفوض',suspended:'موقوف'};
const governorates=['بغداد','النجف','كربلاء','بابل','القادسية','المثنى','ذي قار','ميسان','البصرة','واسط','ديالى','صلاح الدين','الأنبار','نينوى','كركوك','أربيل','دهوك','السليمانية','حلبجة'];
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
 const [emergency,setEmergency]=useState<'visitor'|'doctor'|null>(null);
 const [portal,setPortal]=useState<Portal|null>(null),[session,setSession]=useState<Session|null>(null);
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const [age,setAge]=useState(''),[otp,setOtp]=useState(''),[awaitingOtp,setAwaitingOtp]=useState(false);
 const [registering,setRegistering]=useState(false),[fullName,setFullName]=useState(''),[phone,setPhone]=useState(''),[governorate,setGovernorate]=useState(''),[employerType,setEmployerType]=useState('scientific_office'),[employerName,setEmployerName]=useState('');
 const [tab,setTab]=useState<Tab|null>(null),[rows,setRows]=useState<Row[]>([]),[next,setNext]=useState<string|null>(null),[search,setSearch]=useState('');
 const [centerId,setCenterId]=useState<string|null>(null);const [booking,setBooking]=useState<Booking|null>(null);const [decision,setDecision]=useState<Decision|null>(null);const [service,setService]=useState<{action:string;id:string;description?:string;status?:string;kind?:string;requestId?:string;day?:number;start?:string;end?:string;available?:boolean;unlimited?:boolean;max?:string;price?:string;date?:string;time?:string}|null>(null);
 const active=useRef<AbortController|null>(null);
 function cancel(){active.current?.abort();active.current=null;setBusy(false);}
 function clear(){cancel();setAge('');setOtp('');setAwaitingOtp(false);setRegistering(false);setFullName('');setPhone('');setGovernorate('');setEmployerName('');setEmployerType('scientific_office');setSession(null);setPassword('');setEmail('');setRows([]);setNext(null);setTab(null);setSearch('');setCenterId(null);setBooking(null);setDecision(null);setService(null);}
 useEffect(()=>{if(!session)return;const timer=setTimeout(()=>{clear();setNotice('انتهت الجلسة، سجل الدخول مجدداً.');},Math.max(0,session.expires-Date.now()));return()=>clearTimeout(timer);},[session]);
 useEffect(()=>()=>active.current?.abort(),[]);
 async function logout(){const token=session?.token;clear();setNotice('تم إنهاء الجلسة المحلية.');if(token){try{await request('/api/auth/logout',token,{});}catch{}}}
 function back(){void logout();setPortal(null);setNotice('');}
 async function register(){
 if(busy||!portal||!['patient','representative'].includes(portal.role))return;
 const ctl=new AbortController();active.current=ctl;setBusy(true);setNotice('');
 try{
 if(portal.role==='patient'){
 await request('/api/auth/patient-phone',undefined,{action:'start',phone,fullName,age:Number(age),governorate,password},ctl.signal);
 if(!ctl.signal.aborted){setAwaitingOtp(true);setNotice('أدخل رمز التحقق المرسل إلى واتساب.');}return;
 }
 await request('/api/auth/register',undefined,{accountType:portal.role,fullName,email:email.trim(),password,phone,governorate,employerType,employerName},ctl.signal);
 if(!ctl.signal.aborted){setRegistering(false);setFullName('');setPhone('');setGovernorate('');setEmployerName('');setNotice('إذا قُبل الطلب، تحقق من بريدك الإلكتروني ثم انتظر موافقة الإدارة.');}
 }catch(e){if(!ctl.signal.aborted)setNotice(e instanceof HttpError&&e.status===503?'إنشاء الحسابات غير متاح حالياً في بيئة الاختبار.':e instanceof HttpError&&[400,422].includes(e.status)?'تحقق من معلومات التسجيل وكلمة المرور.':errorMessage(e));}
 finally{if(active.current===ctl){setPassword('');setBusy(false);active.current=null;}}
 }
 async function verifyPhone(){
 if(busy||portal?.role!=='patient'||!awaitingOtp)return;
 const ctl=new AbortController();active.current=ctl;setBusy(true);setNotice('');
 try{
 const result=await request<{access_token:string;expires_in:number}>('/api/auth/patient-phone',undefined,{action:'verify',phone,code:otp},ctl.signal);
 const p=await request<{full_name?:string;role:string;approval_status:string}>('/api/profile/me',result.access_token,undefined,ctl.signal);
 if(p.role!=='patient'||p.approval_status!=='approved'||!Number.isFinite(result.expires_in)||result.expires_in<=0)throw new HttpError(403);
 if(!ctl.signal.aborted){setAwaitingOtp(false);setRegistering(false);setOtp('');setSession({token:result.access_token,name:p.full_name??portal.title,expires:Date.now()+Math.min(result.expires_in,3600)*1000});}
 }catch(e){if(!ctl.signal.aborted)setNotice(e instanceof HttpError&&e.status===503?'التحقق عبر واتساب غير متاح حالياً.':'تعذر تأكيد الرقم، تحقق من الرمز وحالة الحساب.');}
 finally{if(active.current===ctl){setBusy(false);active.current=null;}}
 }
 async function login(){
 if(busy||!portal||!base||!(portal.role==='patient'?phone.trim():email.trim())||!password)return;
 const ctl=new AbortController();active.current=ctl;setBusy(true);setNotice('');
 try{
 const result=await request<{access_token:string;expires_in:number}>('/api/auth/login',undefined,{...(portal.role==='patient'?{phone}:{email:email.trim()}),password},ctl.signal);
 if(typeof result.access_token!=='string'||!Number.isFinite(result.expires_in)||result.expires_in<=0)throw new HttpError(503);
 let name=portal.title;
 if(portal.role==='home_provider'){const p=await request<Page>('/api/provider/workspace?kind=home_provider',result.access_token,undefined,ctl.signal);name=p.displayName??name;}
 else{const p=await request<{full_name?:string;role:string;approval_status:string}>('/api/profile/me',result.access_token,undefined,ctl.signal);if(p.role!==portal.role||p.approval_status!=='approved'){if(!ctl.signal.aborted)setNotice(p.role!==portal.role?'اختر بوابة حسابك الصحيحة.':p.approval_status==='pending'?(portal.role==='patient'?'لم يكتمل تأكيد رقم الهاتف.':'طلبك قيد مراجعة الإدارة.'):p.approval_status==='rejected'?'لم تقبل الإدارة طلب الحساب.':p.approval_status==='suspended'?'الحساب موقوف. تواصل مع الإدارة.':'الحساب غير مخول.');try{await request('/api/auth/logout',result.access_token,{},ctl.signal);}catch{}return;}name=p.full_name??name;}
 if(ctl.signal.aborted)return;
 setSession({token:result.access_token,name,expires:Date.now()+Math.min(result.expires_in,3600)*1000});
 }catch(e){if(!ctl.signal.aborted)setNotice(errorMessage(e));}finally{if(active.current===ctl){setPassword('');setBusy(false);active.current=null;}}
 }
 async function load(selected:Tab,more?:string){
 if(busy||!session)return;const ctl=new AbortController();active.current=ctl;setBusy(true);setNotice('');setTab(selected);
 if(!more){setRows([]);setNext(null);setSearch('');setDecision(null);setService(null);if(selected.kind!=='hours')setBooking(null);}
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
 async function submitService(){
 if(!session||!service||busy||!tab)return;
 const ctl=new AbortController();active.current=ctl;setBusy(true);setNotice('');
 try{
 let requestId=service.requestId;
 if(service.action.startsWith('renew_')&&!requestId){const key=await request<{requestId:string;writesEnabled:boolean}>('/api/services/actions',session.token,undefined,ctl.signal);if(ctl.signal.aborted)return;if(!key.writesEnabled){setNotice('تجديد الاشتراك غير مفعل حالياً.');return;}requestId=key.requestId;if(typeof requestId!=='string')throw new HttpError(503);setService({...service,requestId});}
 const payload={...service,requestId,max:service.max?Number(service.max):undefined,price:service.price?Number(service.price):undefined};
 await request('/api/services/actions',session.token,payload,ctl.signal);
 if(ctl.signal.aborted)return;setService(null);setNotice('تم تنفيذ الإجراء. حدّث القائمة للتحقق من النتيجة.');
 }catch(e){if(!ctl.signal.aborted)setNotice(e instanceof HttpError&&e.status===503?'العملية غير متاحة حالياً؛ لا تكررها قبل مراجعة السجل.':e instanceof HttpError&&e.status===422?'تعذر تنفيذ الإجراء، تحقق من البيانات والصلاحية.':errorMessage(e));}
 finally{if(active.current===ctl){active.current=null;setBusy(false);}}
 }
 function catalog(kind:Tab['kind'],section:string,title:string){void load({title,kind,path:'/api/services/catalog?section='+section});}
 async function markRead(id:string){
 if(!session||busy)return;const ctl=new AbortController();active.current=ctl;setBusy(true);setNotice('');
 try{await request('/api/notifications/read',session.token,{id},ctl.signal);if(!ctl.signal.aborted){setRows(old=>old.map(r=>r.id===id?{...r,is_read:true}:r));setNotice('تم تحديد الإشعار كمقروء.');}}
 catch(e){if(!ctl.signal.aborted)setNotice(e instanceof HttpError&&e.status===503?'تعديل الإشعارات غير متاح حالياً.':errorMessage(e));}
 finally{if(active.current===ctl){active.current=null;setBusy(false);}}
 }
 const allDates=()=>availableDates(days.map((_,day_of_week)=>({day_of_week})));
 const filtered=rows.filter(r=>!search||[r.name,r.full_name,r.specialty,r.city,r.address,r.qualification].some(v=>v?.toLowerCase().includes(search.trim().toLowerCase())));
 if(emergency)return <View style={s.root}><StatusBar barStyle="dark-content"/><ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled"><EmergencyChat base={base} doctor={emergency==='doctor'} onBack={()=>setEmergency(null)}/></ScrollView></View>;
 return <View style={s.root}><StatusBar barStyle="dark-content"/><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.page}>
 <View style={s.hero}><Text style={s.brand}>PATIENT | بيشنت</Text><Text style={s.white}>رعاية صحية رقمية • 2.0</Text></View>
 {!portal?<><Text style={s.heading}>اختر بوابتك</Text><Text style={s.muted}>تطبيق Native جديد، متصل بخادم النسخة الجديدة عند تهيئته. لا تستخدم بيانات طبية حقيقية في المعاينة.</Text>{portals.map(p=><Pressable key={p.role} accessibilityRole="button" style={s.card} onPress={()=>{setPortal(p);setNotice('');}}><Text style={s.title}>{p.title}</Text><Text style={s.muted}>{p.description}</Text></Pressable>)}<Pressable accessibilityRole="button" style={s.card} onPress={()=>setEmergency('visitor')}><Text style={s.title}>محادثة الطوارئ</Text><Text style={s.muted}>تواصل نصي وإرفاق صورة — تجريبي</Text></Pressable><Pressable accessibilityRole="button" style={s.card} onPress={()=>setEmergency('doctor')}><Text style={s.title}>بوابة طبيب الطوارئ</Text><Text style={s.muted}>متابعة المحادثات والمرفقات — تجريبي</Text></Pressable></>:<>
 <Button title="اللوحة الرئيسية" onPress={back} secondary/>
 <Text style={s.heading}>{portal.title}</Text>
 {!base?<View style={s.card}><Text style={s.title}>الخادم التجريبي غير مهيأ</Text><Text style={s.muted}>اضبط EXPO_PUBLIC_PATIENT_API_URL على عنوان HTTPS الخاص بخادم PATIENT 2.0. لم يتم نقل بيانات المنصة الأصلية إلى هذه البيئة.</Text></View>:!session?<View style={s.card}><Text style={s.title}>{registering?'إنشاء حساب جديد':'تسجيل الدخول'}</Text><Text style={s.muted}>بيانات تجريبية فقط</Text>
 {awaitingOtp&&portal.role==='patient'?<><Text style={s.label}>رمز التحقق عبر واتساب</Text><Text style={s.muted}>رقم الهاتف: {phone}</Text><TextInput style={s.input} accessibilityLabel="رمز التحقق" value={otp} onChangeText={setOtp} keyboardType="number-pad" maxLength={6} editable={!busy}/><Button title="تأكيد الرقم والدخول" disabled={busy||otp.length!==6} onPress={()=>void verifyPhone()}/><Button title="تعديل بيانات التسجيل" secondary disabled={busy} onPress={()=>{setAwaitingOtp(false);setOtp('');setNotice('');}}/></>:<>{registering&&<><Text style={s.label}>الاسم الكامل {portal.role==='representative'?'الثلاثي':''}</Text><TextInput style={s.input} value={fullName} onChangeText={setFullName} editable={!busy} maxLength={120}/>{portal.role==='patient'&&<><Text style={s.label}>العمر</Text><TextInput style={s.input} accessibilityLabel="العمر" value={age} onChangeText={setAge} keyboardType="number-pad" maxLength={3} editable={!busy}/></>}<Text style={s.label}>رقم الهاتف (07XXXXXXXXX)</Text><TextInput style={s.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" editable={!busy} maxLength={11}/><Text style={s.label}>المحافظة</Text><View style={s.dateGrid}>{governorates.map(g=><Button key={g} title={g} secondary={governorate!==g} disabled={busy} onPress={()=>setGovernorate(g)}/>)}</View>{portal.role==='representative'&&<><Text style={s.label}>جهة العمل</Text><View style={s.dateGrid}><Button title="مكتب علمي" secondary={employerType!=='scientific_office'} disabled={busy} onPress={()=>setEmployerType('scientific_office')}/><Button title="شركة" secondary={employerType!=='company'} disabled={busy} onPress={()=>setEmployerType('company')}/></View><TextInput style={s.input} value={employerName} onChangeText={setEmployerName} editable={!busy} maxLength={180} placeholder="اسم جهة العمل"/></>}</>}{portal.role==='patient'?(registering?null:<><Text style={s.label}>رقم الهاتف</Text><TextInput style={s.input} accessibilityLabel="رقم الهاتف" keyboardType="phone-pad" value={phone} onChangeText={setPhone} maxLength={11} editable={!busy}/></>):<><Text style={s.label}>البريد الإلكتروني</Text><TextInput style={s.input} accessibilityLabel="البريد الإلكتروني" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" value={email} onChangeText={setEmail} editable={!busy} maxLength={254}/></>}<Text style={s.label}>كلمة المرور</Text><TextInput style={s.input} accessibilityLabel="كلمة المرور" secureTextEntry autoCapitalize="none" value={password} onChangeText={setPassword} editable={!busy} maxLength={1024}/>{registering&&<Text style={s.muted}>12 حرفاً على الأقل لكلمة المرور. {portal.role==='patient'?'يتفعّل حسابك بعد تأكيد رقم واتساب.':'يخضع الحساب لموافقة الإدارة بعد التسجيل.'}</Text>}<Button title={busy?'جارٍ التحقق':registering?(portal.role==='patient'?'إرسال رمز واتساب':'إرسال طلب التسجيل'):'دخول'} onPress={()=>void (registering?register():login())} disabled={busy}/>{['patient','representative'].includes(portal.role)&&<Button title={registering?'لدي حساب بالفعل':'إنشاء حساب'} secondary disabled={busy} onPress={()=>{setRegistering(!registering);setPassword('');setNotice('');}}/>}</>}</View>:<>
 <View style={s.card}><Text style={s.title}>أهلاً {session.name}</Text><Button title="خروج" onPress={()=>void logout()} secondary/></View>
 <FeaturePanel token={session.token} role={portal.role} base={base}/>
 {portal.role==='staff'?null:portal.role==='patient'?<View style={s.tabs}>{patientTabs.map(t=><Button key={t.path} title={t.title} onPress={()=>{setCenterId(null);void load(t);}} disabled={busy} secondary={tab?.path!==t.path}/>)}</View>:<Button title={portal.role==='admin'?'جميع الحسابات':'عرض الطلبات والحجوزات'} onPress={()=>void load(portal.role==='admin'?{title:'جميع الحسابات',path:'/api/admin/accounts',kind:'adminAccounts'}:{title:'لوحة العمل',path:'/api/provider/workspace?kind='+portal.role,kind:'workspace'})} disabled={busy}/>}
 {portal.role==='admin'&&<View style={s.tabs}>{([{role:'patient',label:'المراجعون'},{role:'representative',label:'المندوبون'},{role:'doctor',label:'الأطباء'},{role:'medical_center',label:'المراكز الطبية'}]).map(r=><Button key={r.role} title={r.label} secondary disabled={busy} onPress={()=>void load({title:r.label,path:'/api/admin/accounts?role='+r.role,kind:'adminAccounts'})}/>)}
 <Button title="طلبات الموافقة" secondary disabled={busy} onPress={()=>void load({title:'طلبات الموافقة',path:'/api/admin/accounts?status=pending',kind:'adminAccounts'})}/></View>}
 <View style={s.tabs}><Button title="الإشعارات" disabled={busy} secondary onPress={()=>void load(sectionTab(portal.role,'notifications','الإشعارات'))}/>{['doctor','medical_center','representative','home_provider'].includes(portal.role)&&<Button title="اشتراكي" disabled={busy} secondary onPress={()=>void load(sectionTab(portal.role,'subscription','الاشتراك'))}/>}
 {portal.role==='doctor'&&<Button title="جدول دوامي" disabled={busy} secondary onPress={()=>void load(sectionTab(portal.role,'schedule','جدول الدوام'))}/>}
 {['doctor','representative'].includes(portal.role)&&<Button title="مواعيد زيارات المندوبين" disabled={busy} secondary onPress={()=>void load(sectionTab(portal.role,'visits','مواعيد الزيارات'))}/>}</View>
 {portal.role==='patient'&&<View style={s.tabs}><Button title="خدمات الرعاية المنزلية" secondary disabled={busy} onPress={()=>catalog('homeDirectory','home_directory','خدمات الرعاية المنزلية')}/><Button title="طلباتي المنزلية" secondary disabled={busy} onPress={()=>catalog('homeRequests','home_requests','طلباتي المنزلية')}/></View>}
 {portal.role==='doctor'&&<Button title="طلبات المندوبين" secondary disabled={busy} onPress={()=>catalog('doctorVisits','doctor_visits','طلبات المندوبين')}/>}
 {portal.role==='admin'&&<View style={s.tabs}><Button title="سجل العمليات الأمنية" secondary disabled={busy} onPress={()=>void load({title:'سجل العمليات الأمنية',path:'/api/admin/audit',kind:'audit'})}/><Button title="اشتراكات الأطباء" secondary disabled={busy} onPress={()=>catalog('adminDoctors','admin_doctors','اشتراكات الأطباء')}/><Button title="اشتراكات المراكز" secondary disabled={busy} onPress={()=>catalog('adminCenters','admin_centers','اشتراكات المراكز')}/><Button title="اشتراكات المندوبين" secondary disabled={busy} onPress={()=>catalog('adminReps','admin_reps','اشتراكات المندوبين')}/></View>}
 {tab&&<><Text style={s.heading}>{tab.title}</Text><Button title="تحديث القائمة" secondary disabled={busy} onPress={()=>void load(tab)}/>{['doctors','centers','centerDoctors','adminAccounts'].includes(tab.kind)&&<TextInput style={s.input} accessibilityLabel="البحث في النتائج المحملة" placeholder="بحث في النتائج المحملة" placeholderTextColor="#526970" value={search} onChangeText={setSearch}/>}
 {filtered.map((item,i)=><View key={item.id??i} style={s.card}>
 {tab.kind==='audit'?<><Text style={s.title}>{({INSERT:'إنشاء',UPDATE:'تحديث',DELETE:'حذف'} as Record<string,string>)[item.operation??'']??'عملية'}</Text><Text style={s.muted}>{item.entity} • {dateLabel(item.occurred_at)}</Text><Text style={s.muted}>السجل: {item.entity_key}</Text><Text style={s.muted}>المنفذ: {item.actor_id??'عملية نظام'}</Text>{item.before_state&&<Text style={s.muted}>قبل: {JSON.stringify(item.before_state)}</Text>}{item.after_state&&<Text style={s.muted}>بعد: {JSON.stringify(item.after_state)}</Text>}</>:tab.kind==='hours'||tab.kind==='schedule'?<><Text style={s.title}>{days[item.day_of_week??-1]??'اليوم'}: {item.start_time?.slice(0,5)} – {item.end_time?.slice(0,5)}</Text>{tab.kind==='schedule'&&<Text style={s.muted}>{item.is_available?'متاح':'مغلق'} • {item.unlimited_daily?'عدد غير محدود':'الحد اليومي: '+(item.max_daily_patients??'—')}</Text>}{tab.kind==='schedule'&&item.id&&<Button title="تعديل الدوام" secondary disabled={busy} onPress={()=>setService({action:'schedule_save',id:item.id!,day:item.day_of_week??0,start:item.start_time?.slice(0,5)??'09:00',end:item.end_time?.slice(0,5)??'17:00',available:!!item.is_available,unlimited:!!item.unlimited_daily,max:String(item.max_daily_patients??20)})}/>}</>:tab.kind==='notifications'?<><Text style={s.title}>{item.title??'إشعار'}</Text><Text style={s.muted}>{item.message}</Text><Text style={s.muted}>{item.is_read?'مقروء':'جديد'} • {dateLabel(item.created_at)}</Text>{!item.is_read&&item.id&&<Button title="تحديد كمقروء" secondary disabled={busy} onPress={()=>void markRead(item.id!)}/>}</>:tab.kind==='subscription'?<><Text style={s.title}>حالة الاشتراك</Text><Text style={s.muted}>الانتهاء: {dateLabel(item.subscription_expires_at)||'غير محدد'}</Text><Text style={s.muted}>الرسوم: {item.subscription_fee??'—'} د.ع</Text></>:tab.kind==='visits'?<><Text style={s.title}>{item.visit_date??'زيارة'}</Text><Text style={s.muted}>{item.start_time?.slice(0,5)} – {item.end_time?.slice(0,5)} • العدد: {item.capacity??'—'}</Text><Text style={s.muted}>{item.is_open?'متاح':'مغلق'}</Text>{portal.role==='representative'&&item.id&&item.is_open&&<Button title="طلب زيارة" disabled={busy} onPress={()=>setService({action:'visit_book',id:item.id!})}/>}</>:<><Text style={s.title}>{item.name??item.full_name??item.display_name??item.employer_name??states[item.status??item.approval_status??'']??item.role??'سجل'}</Text>{item.governorate&&<Text style={s.muted}>{item.governorate} • {item.kind}</Text>}{item.quoted_price!=null&&<Text style={s.muted}>عرض السعر: {item.quoted_price} د.ع</Text>}{item.subscription_expires_at&&<Text style={s.muted}>انتهاء الاشتراك: {dateLabel(item.subscription_expires_at)}</Text>}{item.subscription_fee!=null&&<Text style={s.muted}>الرسوم: {item.subscription_fee} د.ع</Text>}
 {tab.kind==='homeDirectory'&&item.id&&<Button title="طلب خدمة" disabled={busy} onPress={()=>setService({action:'home_book',id:item.id!,description:''})}/>}
 {tab.kind==='doctorVisits'&&item.id&&<View style={s.dateGrid}>{(item.status==='pending'?['approved','rejected']:item.status==='approved'?['completed']:[]).map(status=><Button key={status} title={states[status]} secondary disabled={busy} onPress={()=>setService({action:'visit_decide',id:item.id!,status})}/>)}</View>}
 {tab.kind==='workspace'&&portal.role==='home_provider'&&item.id&&<View style={s.dateGrid}>{(item.status==='pending'?['quoted']:item.status==='confirmed'?['en_route']:item.status==='en_route'?['arrived']:item.status==='arrived'?['completed']:[]).map(status=><Button key={status} title={status==='quoted'?'إرسال عرض سعر':states[status]} secondary disabled={busy} onPress={()=>setService({action:'home_progress',id:item.id!,status,price:'',date:'',time:''})}/>)}</View>}
 {['adminDoctors','adminCenters','adminReps'].includes(tab.kind)&&item.id&&<Button title="تسجيل تجديد الاشتراك" secondary disabled={busy} onPress={()=>setService({action:tab.kind==='adminReps'?'renew_rep':'renew_clinical',id:item.id!,kind:tab.kind==='adminDoctors'?'doctor':'medical_center'})}/>}
 {item.specialty&&<Text style={s.muted}>{item.specialty}</Text>}{item.qualification&&<Text style={s.muted}>{item.qualification}</Text>}{item.city&&<Text style={s.muted}>{item.city} {item.address}</Text>}{item.consultation_fee!=null&&<Text style={s.muted}>الأجور: {item.consultation_fee} د.ع</Text>}{item.requested_date&&<Text style={s.muted}>اليوم المطلوب: {item.requested_date}</Text>}{(item.appointment_at||item.scheduled_at)&&<Text style={s.muted}>الموعد: {dateLabel(item.appointment_at??item.scheduled_at)}</Text>}{item.role&&<Text style={s.muted}>الدور: {item.role}</Text>}{item.approval_status&&<Text style={s.muted}>الحالة: {states[item.approval_status]??item.approval_status}</Text>}{tab.kind==='adminAccounts'&&item.created_at&&<Text style={s.muted}>التسجيل: {dateLabel(item.created_at)}</Text>}{tab.kind==='adminAccounts'&&['patient','representative'].includes(item.role??'')&&<View style={s.dateGrid}>{['approved','rejected','suspended'].filter(st=>st!==item.approval_status).map(st=><Button key={st} title={states[st]} disabled={busy} secondary onPress={()=>confirmAccount(item,st)}/>)}</View>}{['doctors','centers','centerDoctors'].includes(tab.kind)&&<Button title={tab.kind==='centers'?'عرض أطباء المركز':'عرض الدوام'} onPress={()=>details(item)} disabled={busy} secondary/>}
 {tab.kind==='bookings'&&['pending','approved','confirmed'].includes(item.status??'')&&<Button title="إلغاء الطلب" secondary disabled={busy} onPress={()=>chooseDecision(item,'cancel')}/>}
 {tab.kind==='workspace'&&['doctor','medical_center'].includes(portal.role)&&item.status==='pending'&&<><Button title="قبول وتحديد الموعد" disabled={busy} onPress={()=>chooseDecision(item,'confirm')}/><Button title="رفض الحجز" secondary disabled={busy} onPress={()=>chooseDecision(item,'reject')}/></>}
 {tab.kind==='workspace'&&['doctor','medical_center'].includes(portal.role)&&['approved','confirmed'].includes(item.status??'')&&<><Button title="تعديل الموعد" secondary disabled={busy} onPress={()=>chooseDecision(item,'reschedule')}/><Button title="إكمال الزيارة" secondary disabled={busy} onPress={()=>chooseDecision(item,'complete')}/></>}
 </>}
 </View>)}{next&&<Button title="عرض المزيد" onPress={()=>void load(tab,next)} disabled={busy}/>}</>}
 {service&&<View style={s.card}><Text style={s.title}>تأكيد العملية</Text>
 {service.action==='schedule_save'&&<><Text style={s.label}>يوم الدوام</Text><View style={s.dateGrid}>{days.map((day,i)=><Button key={day} title={day} secondary={service.day!==i} disabled={busy} onPress={()=>setService({...service,day:i})}/>)}</View>
 <Text style={s.label}>من الساعة / إلى الساعة (HH:MM)</Text><TextInput style={s.input} value={service.start} editable={!busy} maxLength={5} onChangeText={start=>setService({...service,start})}/><TextInput style={s.input} value={service.end} editable={!busy} maxLength={5} onChangeText={end=>setService({...service,end})}/><Button title={service.available?'الدوام متاح':'الدوام مغلق'} secondary disabled={busy} onPress={()=>setService({...service,available:!service.available})}/><Button title={service.unlimited?'العدد غير محدود':'تحديد العدد اليومي'} secondary disabled={busy} onPress={()=>setService({...service,unlimited:!service.unlimited})}/>{!service.unlimited&&<TextInput style={s.input} keyboardType="number-pad" maxLength={4} editable={!busy} value={service.max} onChangeText={max=>setService({...service,max})}/>}</>}
 {service.action==='home_book'&&<><Text style={s.label}>وصف الخدمة المطلوبة (اختبار فقط)</Text><TextInput style={s.input} multiline editable={!busy} maxLength={1000} value={service.description} onChangeText={description=>setService({...service,description})}/></>}
 {service.action==='home_progress'&&service.status==='quoted'&&<><Text style={s.label}>السعر بالدينار</Text><TextInput style={s.input} keyboardType="number-pad" value={service.price} maxLength={9} editable={!busy} onChangeText={price=>setService({...service,price})}/><Text style={s.label}>تاريخ ووقت الخدمة (بتوقيت العراق)</Text><View style={s.dateGrid}>{allDates().map(d=><Button key={d.value} title={d.label} secondary={service.date!==d.value} disabled={busy} onPress={()=>setService({...service,date:d.value})}/>)}</View><TextInput style={s.input} placeholder="HH:MM" value={service.time} maxLength={5} editable={!busy} onChangeText={time=>setService({...service,time})}/></>}
 {service.action.startsWith('renew_')&&<Text style={s.muted}>سجّل التجديد فقط بعد التحقق من الدفع. لا توجد بوابة دفع إلكتروني هنا. إذا تعذر الاتصال، أعد المحاولة من نفس النموذج دون إغلاقه أو إنشاء طلب آخر.</Text>}
 <Button title="تنفيذ" disabled={busy} onPress={()=>void submitService()}/><Button title="إلغاء" secondary disabled={busy} onPress={()=>setService(null)}/></View>}
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
