import {authConfig} from '../../../../lib/auth';
export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export async function POST(request:Request){
 const token=/^Bearer ([A-Za-z0-9._-]{1,8192})$/.exec(request.headers.get('authorization')??'')?.[1];
 if(!token)return reply({error:'Unauthorized'},401);
 const config=authConfig();if(!config||!process.env.APP_ORIGIN)return reply({error:'Unavailable'},503);
 if(request.headers.get('origin')!==process.env.APP_ORIGIN)return reply({error:'Forbidden'},403);
 try{
 const response=await fetch(config.url+'/auth/v1/logout?scope=local',{method:'POST',headers:{apikey:config.key,Authorization:'Bearer '+token},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});
 return response.ok?reply({status:'signed_out'}):reply({error:'Unavailable'},503);
 }catch{return reply({error:'Unavailable'},503);}
}
