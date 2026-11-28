import {adminAuth,getFirebaseAdminProjectId} from '../firebaseAdmin.js';
import {validFreelanceId} from '../../shared/freelanceLifecycle.js';
import {readFreelanceWorkspace} from './freelanceWorkspaceReadService.js';
import {readFreelancePersonalSummary} from './freelancePersonalReadService.js';
import * as lifecycle from './freelanceLifecycleService.js';

export function freelanceWorkspaceEnabled(){
 return process.env.KYRUB_FREELANCE_LOCAL_HOMOLOGATION==='true'&&!process.env.VERCEL&&!process.env.VERCEL_ENV&&
 !process.env.FIREBASE_SERVICE_ACCOUNT_JSON&&!process.env.GOOGLE_APPLICATION_CREDENTIALS&&
 /^(127\.0\.0\.1|localhost):8088$/.test(process.env.FIRESTORE_EMULATOR_HOST??'')&&
 /^(127\.0\.0\.1|localhost):9099$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST??'')&&
 getFirebaseAdminProjectId()==='kyrub-security-test';
}
export async function executeFreelanceWorkspaceAction(uid:string,input:unknown){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('FREELANCE_INVALID');
 const b=input as Record<string,unknown>;
 if(!validFreelanceId(b.offerId))throw Error('FREELANCE_INVALID');
 const exact=(fields:string[])=>{if(Object.keys(b).some(k=>!['action','offerId',...fields].includes(k)))throw Error('FREELANCE_INVALID');};
 switch(b.action){
 case 'publish':exact(['terms']);return lifecycle.publishFreelanceOffer(uid,b.offerId,b.terms);
 case 'apply':exact([]);return lifecycle.applyToFreelanceOffer(uid,b.offerId);
 case 'select':exact(['applicantUid']);if(!validFreelanceId(b.applicantUid))throw Error('FREELANCE_INVALID');return lifecycle.selectFreelanceApplication(uid,b.offerId,b.applicantUid);
 case 'confirm':exact(['confirmed']);return lifecycle.confirmFreelanceContract(uid,b.offerId,b.confirmed);
 case 'release':exact(['applicantUid','confirmed']);if(!validFreelanceId(b.applicantUid))throw Error('FREELANCE_INVALID');return lifecycle.releaseFreelanceReservation(uid,b.offerId,b.applicantUid,b.confirmed);
 case 'withdraw':exact(['confirmed']);return lifecycle.withdrawPendingFreelanceApplication(uid,b.offerId,b.confirmed);
 case 'cancel_open':exact(['confirmed']);return lifecycle.cancelUncontractedFreelanceOffer(uid,b.offerId,b.confirmed);
 case 'start':case 'request_completion':case 'confirm_completion':exact(['confirmed']);return lifecycle.recordFreelanceExecution(uid,b.offerId,b.action,b.confirmed);
 case 'report':exact(['kind','confirmed','occurrenceId']);if(!validFreelanceId(b.occurrenceId))throw Error('FREELANCE_INVALID');return lifecycle.reportFreelanceOccurrence(uid,b.offerId,b.kind,b.confirmed,b.occurrenceId);
 case 'respond':exact(['position','confirmed','occurrenceId']);if(!validFreelanceId(b.occurrenceId))throw Error('FREELANCE_INVALID');return lifecycle.respondToFreelanceOccurrence(uid,b.offerId,b.position,b.confirmed,b.occurrenceId);
 default:throw Error('FREELANCE_INVALID');
 }
}
type Request={method?:string;headers:Record<string,string|string[]|undefined>;query?:Record<string,unknown>;body?:unknown};
type Response={setHeader(name:string,value:string):unknown;status(code:number):{json(body:unknown):unknown}};
type Dependencies={enabled:()=>boolean;verify:(token:string)=>Promise<{uid:string}>;read:(uid:string,view:unknown,offerId?:unknown,cursor?:unknown)=>Promise<unknown>;mutate:(uid:string,input:unknown)=>Promise<unknown>};
const defaults:Dependencies={enabled:freelanceWorkspaceEnabled,verify:token=>adminAuth.verifyIdToken(token,true),read:(uid,view,offerId,cursor)=>view==='alerts'||view==='earnings'?readFreelancePersonalSummary(uid,view):readFreelanceWorkspace(uid,view,offerId,cursor),mutate:executeFreelanceWorkspaceAction};
export async function handleFreelanceWorkspace(req:Request,res:Response,deps:Dependencies=defaults){
 res.setHeader('Cache-Control','private, no-store, max-age=0');
 try{if(!deps.enabled()){res.status(503).json({code:'FREELANCE_DISABLED'});return;}}catch{res.status(503).json({code:'FREELANCE_DISABLED'});return;}
 if(req.method!=='GET'&&req.method!=='POST'){res.setHeader('Allow','GET, POST');res.status(405).json({code:'METHOD_NOT_ALLOWED'});return;}
 const header=req.headers.authorization;
 const token=typeof header==='string'&&header.length<=8199?/^Bearer (\S+)$/i.exec(header)?.[1]:undefined;
 if(!token){res.status(401).json({code:'AUTH_REQUIRED'});return;}
 let uid:string;
 try{uid=(await deps.verify(token)).uid;if(!validFreelanceId(uid))throw Error('AUTH_REQUIRED');}catch{res.status(401).json({code:'AUTH_REQUIRED'});return;}
 try{
  if(req.method==='GET'){res.status(200).json(await deps.read(uid,req.query?.view,req.query?.offerId,req.query?.cursor));return;}
  const media=req.headers['content-type'];
  if(typeof media!=='string'||!/^application\/json(?:\s*;|$)/i.test(media)){res.status(415).json({code:'JSON_REQUIRED'});return;}
  if(Buffer.byteLength(JSON.stringify(req.body)??'','utf8')>16384){res.status(413).json({code:'PAYLOAD_TOO_LARGE'});return;}
  // Mutations return only an acknowledgement; read access is separately scoped.
  await deps.mutate(uid,req.body);
  res.status(200).json({confirmed:true});
 }catch(e){
  const code=e instanceof Error?e.message:'';
  const status=code==='FREELANCE_INVALID'?400:['FREELANCE_FORBIDDEN','IDENTITY_VERIFICATION_REQUIRED'].includes(code)?403:
   ['FREELANCE_CONFLICT','FREELANCE_FUNDING_REQUIRED','FREELANCE_FUNDING_CONFLICT','FREELANCE_FINANCIAL_BASIS_CONFLICT'].includes(code)?409:503;
  res.status(status).json({code:status===503?'FREELANCE_UNAVAILABLE':code});
 }
}
