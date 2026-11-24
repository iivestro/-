import React, {useState} from 'react';
import {SafeAreaView, ScrollView, Text, View, Pressable, StyleSheet, StatusBar} from 'react-native';
const portals = [
 {name:'بوابة المراجع',desc:'الأطباء والمراكز والحجوزات',symbol:'✚'},
 {name:'بوابة الطبيب',desc:'إدارة المواعيد والدوام',symbol:'♡'},
 {name:'بوابة المراكز الطبية',desc:'إدارة الأطباء والحجوزات',symbol:'▦'},
 {name:'بوابة المندوب',desc:'تنظيم الزيارات الطبية',symbol:'◇'}
];
export default function App(){
 const [selected,setSelected]=useState<number|null>(null);
 return <SafeAreaView style={s.root}><StatusBar barStyle="dark-content"/><ScrollView contentContainerStyle={s.body}>
 <View style={s.hero}><Text style={s.brand}>PATIENT</Text><Text style={s.heroTitle}>بيشنت</Text><Text style={s.white}>منصتك للرعاية الصحية الرقمية</Text></View>
 {selected===null?<><Text style={s.heading}>اختر بوابتك</Text>{portals.map((p,i)=><Pressable accessibilityRole="button" key={p.name} onPress={()=>setSelected(i)} style={s.card}><View style={s.copy}><Text style={s.title}>{p.name}</Text><Text style={s.desc}>{p.desc}</Text></View><Text style={s.symbol}>{p.symbol}</Text></Pressable>)}</>:<View style={s.cardDetail}><Text style={s.heading}>{portals[selected].name}</Text><Text style={s.desc}>نسخة تطويرية — تسجيل الدخول والربط بالخدمات غير متاحين بعد.</Text><Pressable accessibilityRole="button" style={s.button} onPress={()=>setSelected(null)}><Text style={s.white}>العودة إلى البوابات</Text></Pressable></View>}
 <Text style={s.footer}>نسخة تطويرية 0.1.0</Text>
 </ScrollView></SafeAreaView>;
}
const s=StyleSheet.create({root:{flex:1,backgroundColor:'#F1F7FA'},body:{padding:20,paddingTop:48,gap:14},hero:{backgroundColor:'#075985',borderRadius:26,padding:28,alignItems:'flex-end'},brand:{color:'#BAE6FD',fontSize:17,fontWeight:'800',letterSpacing:3},heroTitle:{color:'#fff',fontSize:42,fontWeight:'800'},white:{color:'#fff',fontSize:16,textAlign:'right'},heading:{fontSize:24,fontWeight:'700',color:'#15354A',textAlign:'right',marginVertical:8},card:{backgroundColor:'#fff',borderRadius:18,padding:18,flexDirection:'row',alignItems:'center',gap:16,minHeight:94,borderWidth:1,borderColor:'#DCE8EF'},copy:{flex:1},title:{fontSize:19,fontWeight:'700',color:'#15354A',textAlign:'right'},desc:{fontSize:15,color:'#476274',textAlign:'right',lineHeight:24},symbol:{fontSize:30,color:'#075985',width:50,textAlign:'center'},cardDetail:{backgroundColor:'#fff',borderRadius:20,padding:20,gap:18},button:{backgroundColor:'#075985',padding:16,borderRadius:12,alignItems:'center',minHeight:48},footer:{textAlign:'center',color:'#476274',marginTop:12}});