import {adminAuth,adminDb,getFirebaseAdminProjectId} from '../firebaseAdmin.js';
import {validFreelanceId} from '../../shared/freelanceLifecycle.js';
import {readFreelanceWorkspace} from './freelanceWorkspaceReadService.js';

const PROJECT='kyrub-b8d0e';
type Request={method?:string;headers:Record<string,string|string[]|undefined>;query?:Record<string,unknown>;body?:unknown};
type Response={setHeader(name:string,value:string):unknown;status(code:number):{json(body:unknown):unknown}};
type Identity={uid:string;aud:string;email_verified?:boolean};
type Dependencies={
 env:NodeJS.ProcessEnv;
 projectReady:()=>boolean;
 verify:(token:string)=>Promise<Identity>;
 accountEligible:(uid:string)=>Promise<boolean>;
 read:typeof readFreelanceWorkspace;
};
export function freelanceProductionReadEnabled(env:NodeJS.ProcessEnv=process.env){
 return env.KYRUB_FREELANCE_PRODUCTION_READ_ENABLED==='true'&&env.VERCEL==='1'&&env.VERCEL_ENV==='production'&&
 env.NODE_ENV==='production'&&!env.FIRESTORE_EMULATOR_HOST&&!env.FIREBASE_AUTH_EMULATOR_HOST&&
 !env.GOOGLE_APPLICATION_CREDENTIALS&&env.KYRUB_FREELANCE_LOCAL_HOMOLOGATION!=='true'&&
 env.KYRUB_PERSONAL_FINANCE_LOCAL_HOMOLOGATION!=='true';
}
function pilotAllowed(env:NodeJS.ProcessEnv,uid:string){
 const allowed=(env.KYRUB_FREELANCE_PILOT_UIDS??'').split(',').map(x=>x.trim()).filter(Boolean);
 return allowed.length>0&&allowed.length<=20&&allowed.every(validFreelanceId)&&allowed.includes(uid);
}
const defaults:Dependencies={
 env:process.env,
 projectReady:()=>getFirebaseAdminProjectId()===PROJECT&&adminAuth.app.options.projectId===PROJECT&&
 (adminDb as typeof adminDb&{projectId?:string}).projectId===PROJECT,
 verify:token=>adminAuth.verifyIdToken(token,true),
 accountEligible:async uid=>{
  const actor=await adminAuth.getUser(uid);
  if(actor.disabled||!actor.emailVerified||uid.startsWith('tagpk_'))return false;
  const [age,profile]=await adminDb.getAll(adminDb.doc('age_eligibility_private/'+uid),adminDb.doc('identity_verifications/'+uid));
  const roles=profile.get('approvedProfiles');
  return age.get('uid')===uid&&age.get('status')==='verified_adult'&&profile.get('status')==='approved'&&
   Array.isArray(roles)&&roles.some(r=>r==='requester'||r==='freelancer');
 },
 read:readFreelanceWorkspace
};
export async function handleFreelanceProductionRead(req:Request,res:Response,deps:Dependencies=defaults){
 res.setHeader('Cache-Control','private, no-store, max-age=0');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(!freelanceProductionReadEnabled(deps.env)){res.status(503).json({code:'FREELANCE_DISABLED'});return;}
 if(req.method!=='GET'){res.setHeader('Allow','GET');res.status(405).json({code:'METHOD_NOT_ALLOWED'});return;}
 const q=req.query??{};
 if(Object.keys(q).some(k=>!['view','offerId','cursor'].includes(k))||
 !['open','owner','applications','detail','requester_stores'].includes(String(q.view))||
 typeof q.view!=='string'||(q.view==='detail'?!validFreelanceId(q.offerId):q.offerId!==undefined)||
 (q.cursor!==undefined&&!validFreelanceId(q.cursor))||(q.view==='requester_stores'&&q.cursor!==undefined)){
  res.status(400).json({code:'FREELANCE_INVALID'});return;
 }
 const h=req.headers.authorization;
 const token=typeof h==='string'&&h.length<=8199?/^Bearer (\S+)$/i.exec(h)?.[1]:undefined;
 if(!token){res.status(401).json({code:'AUTH_REQUIRED'});return;}
 try{if(!deps.projectReady())throw Error();}catch{res.status(503).json({code:'FREELANCE_UNAVAILABLE'});return;}
 let uid:string;
 try{const identity=await deps.verify(token);if(identity.aud!==PROJECT||identity.email_verified!==true||!validFreelanceId(identity.uid))throw Error();uid=identity.uid;}
 catch{res.status(401).json({code:'AUTH_REQUIRED'});return;}
 try{
  if(!pilotAllowed(deps.env,uid)||!await deps.accountEligible(uid)){res.status(403).json({code:'FREELANCE_FORBIDDEN'});return;}
  res.status(200).json(await deps.read(uid,q.view,q.offerId,q.cursor));
 }catch(e){
  const code=e instanceof Error?e.message:'';
  const status=code==='FREELANCE_FORBIDDEN'||code==='FREELANCE_STORE_FORBIDDEN'?403:code==='FREELANCE_INVALID'?400:503;
  res.status(status).json({code:status===503?'FREELANCE_UNAVAILABLE':code});
 }
}
