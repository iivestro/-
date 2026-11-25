import {authConfig,verifyUser} from '../../../../lib/auth';
export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(request:Request){
 const token=/^Bearer ([A-Za-z0-9._-]{1,8192})$/.exec(request.headers.get('authorization')??'')?.[1];if(!token)return reply({error:'Unauthorized'},401);
 const config=authConfig();if(!config)return reply({error:'Unavailable'},503);
 const before=new URL(request.url).searchParams.get('after');
 if(before!==null&&(!/^[1-9]\d{0,14}$/.test(before)||!Number.isSafeInteger(Number(before))))return reply({error:'Invalid cursor'},400);
 try{
 const user=await verifyUser(token);if(!user)return reply({error:'Unauthorized'},401);
 const headers={apikey:config.key,Authorization:'Bearer '+token,'Content-Type':'application/json'};
 const response=await fetch(config.url+'/rest/v1/rpc/v2_admin_audit_page',{method:'POST',headers,body:JSON.stringify({p_before:before===null?null:Number(before)}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});
 if(response.status===403||response.status===401)return reply({error:'Forbidden'},403);
 if(!response.ok)return reply({error:'Unavailable'},503);
 const rows=await response.json();if(!Array.isArray(rows))return reply({error:'Unavailable'},503);
 const items=rows.slice(0,25).map(r=>({...r,id:String(r.id)}));
 return reply({items,next:rows.length>25?items[24].id:null});
 }catch{return reply({error:'Unavailable'},503);}
}
