import {authConfig,verifyUser} from '../../../../lib/auth';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
export async function GET(request:Request) {
 const token=request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9._-]{1,8192})$/i)?.[1];
 if(!token) return Response.json({error:'Unauthorized'},{status:401,headers});
 const config=authConfig();
 if(!config) return Response.json({error:'Unavailable'},{status:503,headers});
 try {
  const user=await verifyUser(token);
  if(!user) return Response.json({error:'Unauthorized'},{status:401,headers});
  const url=new URL(config.url+'/rest/v1/profiles');
  url.searchParams.set('id','eq.'+user.id);
  url.searchParams.set('select','id,full_name,role,approval_status');
  url.searchParams.set('limit','1');
  const res=await fetch(url,{headers:{apikey:config.key,Authorization:'Bearer '+token},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});
  if(!res.ok) return Response.json({error:'Unavailable'},{status:503,headers});
  const rows=await res.json();
  const row=Array.isArray(rows)?rows[0]:null;
  if(!row || row.id!==user.id) return Response.json({error:'Not found'},{status:404,headers});
  return Response.json({id:user.id,full_name:typeof row.full_name==='string'?row.full_name:null,role:typeof row.role==='string'?row.role:null,approval_status:typeof row.approval_status==='string'?row.approval_status:null},{headers});
 } catch {return Response.json({error:'Unavailable'},{status:503,headers});}
}
