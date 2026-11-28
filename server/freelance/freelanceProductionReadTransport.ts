import {adminAuth,adminDb,getFirebaseAdminProjectId} from '../firebaseAdmin.js';
import {validFreelanceId} from '../../shared/freelanceLifecycle.js';
import {readFreelanceWorkspace} from './freelanceWorkspaceReadService.js';

import {FREELANCE_PRODUCTION_PROJECT as PROJECT,freelanceProductionReadEnabled,freelancePilotAllowed,freelancePrecontractEnabled} from './freelanceProductionPolicy.js';
import {executeProductionPrecontractAction} from './freelanceProductionPrecontract.js';
export {freelanceProductionReadEnabled};
type Request={method?:string;headers:Record<string,string|string[]|undefined>;query?:Record<string,unknown>;body?:unknown};
type Response={setHeader(name:string,value:string):unknown;status(code:number):{json(body:unknown):unknown}};
type Identity={uid:string;aud:string;email_verified?:boolean};
type Dependencies={
 env:NodeJS.ProcessEnv;
 projectReady:()=>boolean;
 verify:(token:string)=>Promise<Identity>;
 accountEligible:(uid:string)=>Promise<boolean>;
 read:typeof readFreelanceWorkspace;
 mutate?:(uid:string,input:unknown)=>Promise<unknown>;
};
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
 read:(uid,view,offerId,cursor)=>readFreelanceWorkspace(uid,view,offerId,cursor,true),
 mutate:executeProductionPrecontractAction
};
export async function handleFreelanceProductionRead(req:Request,res:Response,deps:Dependencies=defaults){
 res.setHeader('Cache-Control','private, no-store, max-age=0');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(!freelanceProductionReadEnabled(deps.env)){res.status(503).json({code:'FREELANCE_DISABLED'});return;}
 const write=req.method==='POST';
 if(req.method!=='GET'&&(!write||!freelancePrecontractEnabled(deps.env))){res.setHeader('Allow','GET');res.status(405).json({code:'METHOD_NOT_ALLOWED'});return;}
 const q=req.query??{};
 if(write){
  if(Object.keys(q).length){res.status(400).json({code:'FREELANCE_INVALID'});return;}
  const media=req.headers['content-type'];
  if(typeof media!=='string'||!/^application\/json(?:\s*;|$)/i.test(media)){res.status(415).json({code:'JSON_REQUIRED'});return;}
  if(Buffer.byteLength(JSON.stringify(req.body)??'','utf8')>16384){res.status(413).json({code:'PAYLOAD_TOO_LARGE'});return;}
 }else if(Object.keys(q).some(k=>!['view','offerId','cursor'].includes(k))||
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
  if(!freelancePilotAllowed(deps.env,uid)||!await deps.accountEligible(uid)){res.status(403).json({code:'FREELANCE_FORBIDDEN'});return;}
  if(write){if(!deps.mutate)throw Error('FREELANCE_FORBIDDEN');await deps.mutate(uid,req.body);res.status(200).json({confirmed:true});return;}
  res.status(200).json(await deps.read(uid,q.view,q.offerId,q.cursor));
 }catch(e){
  const code=e instanceof Error?e.message:'';
  const status=['FREELANCE_FORBIDDEN','FREELANCE_STORE_FORBIDDEN','IDENTITY_VERIFICATION_REQUIRED'].includes(code)?403:code==='FREELANCE_INVALID'?400:['FREELANCE_CONFLICT','FREELANCE_DIRECT_PAYMENT_NOT_ENABLED','FREELANCE_FINANCIAL_RESTRICTION','FREELANCE_RESTRICTION_CONFLICT','FREELANCE_WORK_MODE_NOT_ENABLED'].includes(code)?409:503;
  res.status(status).json({code:status===503?'FREELANCE_UNAVAILABLE':code});
 }
}
