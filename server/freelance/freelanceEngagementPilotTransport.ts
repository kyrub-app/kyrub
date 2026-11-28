import {adminAuth} from '../firebaseAdmin.js';
import {validFreelanceId,normalizeFreelanceOffer} from '../../shared/freelanceLifecycle.js';
import {assertEngagementPilotAuthority,freelanceEngagementPilotEnabled,freelanceEngagementPilotAllows,assertContractPilotTerms,freelanceContractPilotEnabled,freelanceAdmissionReady} from './freelanceEngagementPilotAuthority.js';
import * as lifecycle from './freelanceLifecycleService.js';

type Request={method?:string;headers:Record<string,string|string[]|undefined>;query?:Record<string,unknown>;body?:unknown};
type Response={setHeader(name:string,value:string):unknown;status(code:number):{json(body:unknown):unknown}};
const admissionActions=['publish','apply','select'];
const contractActions=['confirm','start','request_completion','confirm_completion'];
export async function executeEngagementPilotAction(uid:string,input:unknown){
 assertEngagementPilotAuthority(uid);
 const b=validateEngagementPilotAction(input);
 if(admissionActions.includes(String(b.action))&&!freelanceAdmissionReady())throw Error('FREELANCE_DIRECT_PAYMENT_NOT_ENABLED');
 if(contractActions.includes(String(b.action))&&!freelanceContractPilotEnabled())throw Error('FREELANCE_DIRECT_PAYMENT_NOT_ENABLED');
 switch(b.action){
 case 'publish':{const terms=normalizeFreelanceOffer(b.terms);assertContractPilotTerms(terms);await lifecycle.publishFreelanceOffer(uid,b.offerId,terms,undefined,true);break;}
 case 'apply':await lifecycle.applyToFreelanceOffer(uid,b.offerId,{expected:b.expectedPaymentTerms,expectedWorkTerms:b.expectedWorkTerms,counterproposal:b.counterproposal},true);break;
 case 'select':await lifecycle.selectFreelanceApplication(uid,b.offerId,b.applicantUid as string,b.expectedCounterproposal,true);break;
 case 'confirm':await lifecycle.confirmFreelanceContract(uid,b.offerId,b.confirmed,{expected:b.expectedPaymentTerms,expectedWorkTerms:b.expectedWorkTerms},true);break;
 case 'start':case 'request_completion':case 'confirm_completion':await lifecycle.recordFreelanceExecution(uid,b.offerId,b.action,b.confirmed,true);break;
 case 'release':await lifecycle.releaseFreelanceReservation(uid,b.offerId,b.applicantUid as string,b.confirmed,true);break;
 case 'withdraw':await lifecycle.withdrawPendingFreelanceApplication(uid,b.offerId,b.confirmed,true);break;
 case 'cancel_open':await lifecycle.cancelUncontractedFreelanceOffer(uid,b.offerId,b.confirmed,true);break;
 default:throw Error('FREELANCE_INVALID');
 }
}
export function validateEngagementPilotAction(input:unknown):Record<string,unknown>&{offerId:string}{
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('FREELANCE_INVALID');
 const b=input as Record<string,unknown>;
 if(!validFreelanceId(b.offerId))throw Error('FREELANCE_INVALID');
 const allowed=b.action==='publish'?['terms']:b.action==='apply'?['expectedPaymentTerms','expectedWorkTerms','counterproposal']:b.action==='select'?['applicantUid','expectedCounterproposal']:b.action==='release'?['applicantUid','confirmed']:b.action==='confirm'?['confirmed','expectedPaymentTerms','expectedWorkTerms']:b.action==='withdraw'||b.action==='cancel_open'||contractActions.includes(String(b.action))?['confirmed']:null;
 if(!allowed||Object.keys(b).some(k=>!['action','offerId',...allowed].includes(k)))throw Error('FREELANCE_INVALID');
 if(b.action==='publish')assertContractPilotTerms(normalizeFreelanceOffer(b.terms));
 if((b.action==='apply'||b.action==='confirm')&&(!b.expectedPaymentTerms||!b.expectedWorkTerms))throw Error('FREELANCE_INVALID');
 if((b.action==='release'||b.action==='withdraw'||b.action==='cancel_open'||contractActions.includes(String(b.action)))&&b.confirmed!==true)throw Error('FREELANCE_INVALID');
 if((b.action==='select'||b.action==='release')&&!validFreelanceId(b.applicantUid))throw Error('FREELANCE_INVALID');
 return {...b,offerId:b.offerId};
}
type Dependencies={env:NodeJS.ProcessEnv;verify:(token:string)=>Promise<{uid:string;aud:string;email_verified?:boolean}>;authorize:(uid:string)=>void;execute:(uid:string,input:unknown)=>Promise<void>};
const defaults:Dependencies={env:process.env,verify:token=>adminAuth.verifyIdToken(token,true),authorize:assertEngagementPilotAuthority,execute:executeEngagementPilotAction};
export async function handleFreelanceEngagementPilot(req:Request,res:Response,deps:Dependencies=defaults){
 res.setHeader('Cache-Control','private, no-store, max-age=0');res.setHeader('X-Content-Type-Options','nosniff');
 if(!freelanceEngagementPilotEnabled(deps.env)){res.status(503).json({code:'FREELANCE_DISABLED'});return;}
 if(req.method!=='POST'){res.setHeader('Allow','POST');res.status(405).json({code:'METHOD_NOT_ALLOWED'});return;}
 if(Object.keys(req.query??{}).length){res.status(400).json({code:'FREELANCE_INVALID'});return;}
 const h=req.headers.authorization,token=typeof h==='string'&&h.length<=8199?/^Bearer (\S+)$/i.exec(h)?.[1]:undefined;
 if(!token){res.status(401).json({code:'AUTH_REQUIRED'});return;}
 let uid:string;
 try{const i=await deps.verify(token);if(i.aud!=='kyrub-b8d0e'||i.email_verified!==true||!validFreelanceId(i.uid))throw Error();uid=i.uid;}catch{res.status(401).json({code:'AUTH_REQUIRED'});return;}
 if(!freelanceEngagementPilotAllows(uid,deps.env)){res.status(403).json({code:'FREELANCE_FORBIDDEN'});return;}
 try{
  deps.authorize(uid);
  const media=req.headers['content-type'];
  if(typeof media!=='string'||!/^application\/json(?:\s*;|$)/i.test(media)){res.status(415).json({code:'JSON_REQUIRED'});return;}
  if(Buffer.byteLength(JSON.stringify(req.body)??'','utf8')>16384){res.status(413).json({code:'PAYLOAD_TOO_LARGE'});return;}
  const action=validateEngagementPilotAction(req.body);
  if(admissionActions.includes(String(action.action))&&!freelanceAdmissionReady(deps.env)){res.status(503).json({code:'FREELANCE_DISABLED'});return;}
  if(contractActions.includes(String(action.action))&&!freelanceContractPilotEnabled(deps.env)){res.status(503).json({code:'FREELANCE_DISABLED'});return;}
  await deps.execute(uid,req.body);
  res.status(200).json({confirmed:true});
 }catch(e){
  const code=e instanceof Error?e.message:'';
  const status=['FREELANCE_INVALID'].includes(code)?400:['FREELANCE_FORBIDDEN','FREELANCE_STORE_FORBIDDEN','IDENTITY_VERIFICATION_REQUIRED','FREELANCE_FINANCIAL_RESTRICTION'].includes(code)?403:code==='FREELANCE_CONFLICT'?409:503;
  res.status(status).json({code:status===503?'FREELANCE_UNAVAILABLE':code});
 }
}
