import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'بيشنت | PATIENT', description: 'بوابتك للرعاية الصحية الرقمية' };
export default function Layout({children}: Readonly<{children: React.ReactNode}>) {
 return <html lang="ar" dir="rtl"><body>{children}</body></html>;
}
