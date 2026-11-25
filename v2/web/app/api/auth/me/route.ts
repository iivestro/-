import {authConfig,verifyUser} from '../../../../lib/auth';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
export async function GET(request:Request) {
 const token=request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9._-]{1,8192})$/i)?.[1];
 if(!token) return Response.json({error:'Unauthorized'},{status:401,headers});
 if(!authConfig()) return Response.json({error:'Unavailable'},{status:503,headers});
 try {
 const user=await verifyUser(token);
 if(!user) return Response.json({error:'Unauthorized'},{status:401,headers});
 return Response.json({id:user.id},{headers});
 } catch {return Response.json({error:'Unavailable'},{status:503,headers});}
}
