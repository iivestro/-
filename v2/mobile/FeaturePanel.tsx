import {useEffect,useRef,useState} from 'react';
import {Alert,Platform,Pressable,StyleSheet,Text,TextInput,View} from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
declare const process:{env:{EXPO_PUBLIC_EAS_PROJECT_ID?:string}};
import {features,labels,display,type FeatureDefinition} from './features';
export default function FeaturePanel({token,role,base}:{token:string;role:string;base:string|null}){
 const [selected,setSelected]=useState<FeatureDefinition|null>(null),[form,setForm]=useState<Record<string,string>>({}),[result,setResult]=useState<unknown>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const active=useRef<AbortController|null>(null);
 useEffect(()=>()=>active.current?.abort(),[token]);
 async function run(action:string,data:Record<string,unknown>={}){
 if(busy||!base)return;setBusy(true);setNotice('');setResult(null);const ctl=new AbortController();active.current=ctl;const timer=setTimeout(()=>ctl.abort(),12000);
 try{const r=await fetch(base+'/api/features',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Origin:base},body:JSON.stringify({action,data}),signal:ctl.signal});if(!r.ok)throw Error(r.status===503?'الوظائف الجديدة قيد الاختبار ولم تُفعّل بعد.':'تعذر تنفيذ الطلب. تحقق من البيانات والصلاحية.');const json=await r.json();if(!ctl.signal.aborted)setResult(json.result);}
 catch(e){if(!ctl.signal.aborted)setNotice(e instanceof Error?e.message:'تعذر الاتصال.');}
 finally{clearTimeout(timer);if(active.current===ctl){active.current=null;setBusy(false);}}
 }
 async function locate(){if(busy)return;setBusy(true);setNotice('');try{const p=await Location.requestForegroundPermissionsAsync();if(!p.granted){setNotice('لم تمنح إذن الموقع.');return;}const pos=await Location.getCurrentPositionAsync({accuracy:Location.Accuracy.Balanced});setForm(f=>({...f,latitude:String(pos.coords.latitude),longitude:String(pos.coords.longitude)}));setNotice('تم تحديد الموقع. اضغط تنفيذ للبحث.');}catch{setNotice('تعذر تحديد الموقع.');}finally{setBusy(false);}}
 async function configurePush(enable:boolean){const projectId=process.env.EXPO_PUBLIC_EAS_PROJECT_ID;if(!projectId||!['ios','android'].includes(Platform.OS)){setNotice('لم يتم تهيئة مشروع الإشعارات للتطبيق بعد.');return;}if(busy)return;setNotice('');
 try{
 if(Platform.OS==='android')await Notifications.setNotificationChannelAsync('default',{name:'تنبيهات بيشنت',importance:Notifications.AndroidImportance.DEFAULT});
 let p=await Notifications.getPermissionsAsync();if(enable&&!p.granted)p=await Notifications.requestPermissionsAsync();
 if(!p.granted){setNotice('إذن الإشعارات غير متاح.');return;}
 const device=(await Notifications.getExpoPushTokenAsync({projectId})).data;
 await run(enable?'push_register':'push_remove',enable?{token:device,platform:Platform.OS,consent:true}:{token:device});
 }catch{setNotice('تعذر إعداد الإشعارات؛ يلزم تطبيق تطوير مهيأ.');}}
 function choose(f:FeatureDefinition){setSelected(f);setForm({});setResult(null);setNotice('');if(!f.fields)void run(f.action);}
 function submit(){if(!selected)return;const d:Record<string,unknown>={};for(const [key,label,type] of selected.fields??[]){const v=(form[key]??'').trim();if(type==='optional'&&!v)continue;if(!v){setNotice('أكمل '+label);return;}if(type==='number'){if(!Number.isFinite(Number(v))){setNotice('أدخل رقماً صحيحاً.');return;}d[key]=Number(v);}else if(type==='datetime-local'){const dt=new Date(v);if(Number.isNaN(dt.valueOf())){setNotice('التاريخ غير صحيح.');return;}d[key]=dt.toISOString();}else d[key]=v;}
 if(selected.action==='queue_checkin')d.kind=role==='doctor'?'doctor':'center';void run(selected.action,d);}
 const button=(title:string,fn:()=>void,primary=false)=><Pressable accessibilityRole="button" disabled={busy} onPress={fn} style={[s.button,primary&&s.primary,busy&&s.disabled]}><Text style={primary?s.white:s.label}>{title}</Text></Pressable>;
 const rows=Array.isArray(result)?result.map(v=>typeof v==='string'?{permission:v}:v):result&&typeof result==='object'?[result]:[];
 return <View style={s.card}><Text style={s.title}>الخدمات المتقدمة</Text><Text style={s.note}>بيئة اختبار. الملف الصحي سجلات نصية خاصة. رفع الملفات، المشاركة والتنبيهات الخارجية قيد الإكمال.</Text>
 {features.filter(f=>f.roles.includes(role)&&f.action!=='payment_record').map(f=><Pressable key={f.action} accessibilityRole="button" disabled={busy} style={[s.button,selected?.action===f.action&&s.primary]} onPress={()=>choose(f)}><Text style={selected?.action===f.action?s.white:s.label}>{f.title}</Text></Pressable>)}
 {button('تفعيل إشعارات الهاتف',()=>void configurePush(true))}{button('إلغاء تسجيل إشعارات هذا الجهاز',()=>void configurePush(false))}
 {role==='admin'&&<Text style={s.note}>تسجيل الدفعات متاح في واجهة الويب التجريبية بعد التفعيل.</Text>}
 {selected&&<View style={s.inner}><Text style={s.title}>{selected.title}</Text>{selected.fields?.map(([key,label,type])=><View key={key} style={{gap:6}}><Text style={s.label}>{label}</Text>{type?.includes('|')?<View style={s.options}>{type.split('|').map(v=><Pressable key={v} accessibilityRole="button" disabled={busy} onPress={()=>setForm(f=>({...f,[key]:v}))} style={[s.button,form[key]===v&&s.primary]}><Text style={form[key]===v?s.white:s.label}>{display(v)}</Text></Pressable>)}</View>:<TextInput accessibilityLabel={label} value={form[key]??''} onChangeText={v=>setForm(f=>({...f,[key]:v}))} placeholder={type==='date'?'YYYY-MM-DD':type==='datetime-local'?'YYYY-MM-DDTHH:MM':undefined} keyboardType={type==='number'?'numbers-and-punctuation':'default'} maxLength={2000} editable={!busy} style={s.input}/>}</View>)}
 {selected.fields?button('تنفيذ',submit,true):button('تحديث',()=>void run(selected.action))}
 {selected.action==='nearby'&&<>{button('استخدام موقعي بعد إذني',()=>void locate())}<Text style={s.note}>يُستخدم الموقع لهذا البحث فقط، ولا يتم تتبعك في الخلفية.</Text></>}
 {Array.isArray(result)&&result.length===0&&<Text style={s.note}>لا توجد نتائج.</Text>}
 {rows.map((row,i)=><View key={String(row.id??i)} style={s.inner}>{Object.entries(row).filter(([k])=>k!=='id').map(([k,v])=><Text style={s.note} key={k}>{labels[k]??k}: {display(v)}</Text>)}
 {selected.action==='support_list'&&['admin','staff'].includes(role)&&row.status==='open'&&<><TextInput accessibilityLabel="رد الإدارة" placeholder="اكتب الرد" style={s.input} value={form['reply_'+row.id]??''} onChangeText={v=>setForm(f=>({...f,['reply_'+row.id]:v}))} maxLength={2000}/>{button('إرسال الرد',()=>void run('support_reply',{id:row.id,reply:form['reply_'+row.id]??''}),true)}</>}
 {selected.action==='queue_bookings'&&button('تسجيل الحضور وإصدار الدور',()=>void run('queue_checkin',{booking_id:row.id,kind:role==='doctor'?'doctor':'center'}),true)}
 {selected.action==='queue_provider'&&['waiting','called'].includes(String(row.state))&&<>{row.state==='waiting'?button('نداء المراجع',()=>void run('queue_update',{id:row.id,state:'called'}),true):button('إنهاء الدور',()=>void run('queue_update',{id:row.id,state:'completed'}),true)}{button('إلغاء الدور',()=>void run('queue_update',{id:row.id,state:'cancelled'}))}</>}
 {selected.action==='health_list'&&button('حذف السجل',()=>Alert.alert('حذف السجل','هل تريد حذف هذا السجل؟',[{text:'رجوع',style:'cancel'},{text:'حذف',style:'destructive',onPress:()=>void run('health_delete',{id:row.id})}]))}
 {selected.action==='announcement_admin_list'&&button(row.published?'إلغاء النشر':'نشر',()=>void run('announcement_publish',{id:row.id,published:!row.published}),true)}
 </View>)}</View>}
 {notice?<Text accessibilityLiveRegion="polite" style={s.note}>{notice}</Text>:null}</View>;
}
const s=StyleSheet.create({card:{backgroundColor:'#fff',borderWidth:1,borderColor:'#cfe5e2',borderRadius:18,padding:16,gap:8},inner:{backgroundColor:'#f3faf9',borderRadius:12,padding:12,gap:8},title:{fontSize:19,fontWeight:'700',textAlign:'right',color:'#153b49'},note:{fontSize:14,lineHeight:23,textAlign:'right',color:'#395b60'},button:{minHeight:44,backgroundColor:'#e1efed',borderRadius:12,padding:12,justifyContent:'center'},primary:{backgroundColor:'#08777e'},label:{fontSize:15,fontWeight:'600',color:'#075b62',textAlign:'center'},white:{color:'#fff',fontWeight:'600',textAlign:'center'},input:{backgroundColor:'#fff',borderColor:'#99c9c7',borderWidth:1,borderRadius:10,minHeight:48,padding:10,textAlign:'right',color:'#153b49'},options:{flexDirection:'row',flexWrap:'wrap',gap:6},disabled:{opacity:.55}});
