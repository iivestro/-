import PatientSignIn from '../patients/sign-in';
import Workspace from '../workspace';
import Link from 'next/link';
import {notFound} from 'next/navigation';
import {portals} from '../../../lib/portals';
export function generateStaticParams(){return portals.map(p=>({slug:p.slug}));}
export default async function Portal({params}:{params:Promise<{slug:string}>}){
 const {slug}=await params;
 const portal=portals.find(p=>p.slug===slug);
 if(!portal) notFound();
 return <main><Link href="/">العودة إلى الرئيسية</Link><section className="hero"><h1>{portal.title}</h1><p>{portal.description}</p></section>{slug==='patients'?<PatientSignIn/>:slug==='doctor'?<Workspace role="doctor"/>:slug==='medical-center'?<Workspace role="medical_center"/>:slug==='representatives'?<Workspace role="representative"/>:slug==='admin'?<Workspace role="admin"/>:<article><h2>النسخة التجريبية</h2><p>هذه واجهة تطويرية. لم يتم تفعيل تسجيل الدخول أو الوصول إلى البيانات أو العمليات الطبية بعد.</p><p>تظل الخدمات الحالية متاحة عبر النسخة الأصلية.</p></article>}</main>;
}
