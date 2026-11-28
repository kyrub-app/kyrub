import {adminAuth,adminDb} from '../firebaseAdmin.js';
import {validFreelanceId} from '../../shared/freelanceLifecycle.js';
import {assertEngagementPilotAuthority,assertContractPilotTerms,freelanceContractPilotEnabled,freelanceEngagementPilotAllows} from './freelanceEngagementPilotAuthority.js';
import {personalPixRecentLogin} from '../payments/personalPixTransport.js';
import * as pix from './freelancePixDestinationService.js';
import {readFinancialContext,checkedReview,recordFreelanceExternalPaymentStatement,requestFreelanceFinancialReview} from './freelanceExternalPaymentStatementService.js';
import {assertFinancialCaseRestrictions,readOwnFreelanceRestrictions} from './freelanceEngagementRestrictionService.js';

type Request={method?:string;headers:Record<string,string|string[]|undefined>;query?:Record<string,unknown>;body?:unknown};
type Response={setHeader(name:string,value:string):unknown;status(code:number):{json(body:unknown):unknown}};
const fields:Record<string,string[]>={
 bind_pix:['expectedRevision','confirmed'],authorize_pix_share:['expectedRevision','confirmed'],reveal_pix:['expectedRevision','confirmed'],
 revoke_pix_share:['expectedRevision','expectedSequence','confirmed'],restore_pix_share:['expectedRevision','expectedSequence','confirmed'],
 propose_pix_rebind:['oldRevision','newRevision','confirmed'],accept_pix_rebind:['oldRevision','newRevision','confirmed','paymentNotSent'],
 statement:['eventId','statement','confirmed'],request_review:['confirmed']
};
export function validateFinancePilotAction(input:unknown){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('FREELANCE_INVALID');
 const b=input as Record<string,unknown>;
 if(typeof b.action!=='string'||!Object.prototype.hasOwnProperty.call(fields,b.action)||!validFreelanceId(b.offerId)||b.confirmed!==true)throw Error('FREELANCE_INVALID');
 const allowed=['action','offerId',...fields[b.action]];
 if(Object.keys(b).length!==allowed.length||Object.keys(b).some(k=>!allowed.includes(k)))throw Error('FREELANCE_INVALID');
 return {...b,action:b.action,offerId:b.offerId} as Record<string,unknown>&{action:string;offerId:string};
}
async function read(uid:string,view:string,id:string|undefined){
 assertEngagementPilotAuthority(uid);
 if(view==='restrictions')return readOwnFreelanceRestrictions(uid);
 if(!id)throw Error('FREELANCE_INVALID');
 if(view==='pix_sharing')return pix.readFreelancePixSharing(uid,id,true);
 if(view==='pix_rebind')return pix.readFreelancePixRebind(uid,id,true);
 if(view==='pix_withdrawal')return pix.readFreelancePixWithdrawal(uid,id,true);
 if(view!=='case')throw Error('FREELANCE_INVALID');
 return adminDb.runTransaction(async tx=>{
  const c=await readFinancialContext(tx,uid,id,true);
  assertContractPilotTerms(c.offer);
  assertEngagementPilotAuthority(c.obligation.requesterUid);assertEngagementPilotAuthority(c.obligation.beneficiaryUid);
  const review=checkedReview((await tx.get(adminDb.doc('freelanceFinancialReviewsV1/'+id))).data(),c.obligation);
  const restricted=c.projection.state==='disputed'&&review?.status!=='resolved_administratively';
  await assertFinancialCaseRestrictions(tx,c.obligation,restricted);
  const role=uid===c.obligation.requesterUid?'requester':'freelancer';
  return {offerId:id,role,amountMinor:c.obligation.terms.amountMinor,currency:'BRL',timing:c.obligation.terms.timing,operationalStatus:c.offer.status,due:c.due,financialState:c.due?c.projection.state:'not_due',hadDisagreement:c.projection.hadDisagreement,bankVerified:false,restrictionActive:restricted,reviewStatus:review?.status??null,reviewOutcome:review?.decision?.outcome??null,requestedAt:review?.requestedAt??null,statements:c.events.map(e=>({role:e.actorUid===uid?role:role==='requester'?'freelancer':'requester',statement:e.statement,recordedAt:e.recordedAt})),ownNotes:[],ownReceipts:[],canRequestReview:restricted&&!review,canSubmitEvidence:false};
 },{readOnly:true});
}
async function execute(uid:string,input:unknown){
 assertEngagementPilotAuthority(uid);
 const b=validateFinancePilotAction(input),id=b.offerId;
 const revision={expectedRevision:b.expectedRevision,confirmed:b.confirmed};
 switch(b.action){
 case 'bind_pix':await pix.bindFreelancePixDestination(uid,id,revision,true);break;
 case 'authorize_pix_share':await pix.authorizeFreelancePixSharing(uid,id,revision,true);break;
 case 'reveal_pix':return pix.revealFreelancePixDestination(uid,id,revision,true);
 case 'revoke_pix_share':case 'restore_pix_share':await pix.changeFreelancePixSharingConsent(uid,id,b.action==='revoke_pix_share'?'revoke':'restore',{...revision,expectedSequence:b.expectedSequence},true);break;
 case 'propose_pix_rebind':case 'accept_pix_rebind':await pix.changeFreelancePixBinding(uid,id,b.action==='propose_pix_rebind'?'propose':'accept',{oldRevision:b.oldRevision,newRevision:b.newRevision,confirmed:b.confirmed,...(b.action==='accept_pix_rebind'?{paymentNotSent:b.paymentNotSent}:{})},true);break;
 case 'statement':await recordFreelanceExternalPaymentStatement(uid,id,{eventId:b.eventId,statement:b.statement,confirmed:b.confirmed},true);break;
 case 'request_review':await requestFreelanceFinancialReview(uid,id,{confirmed:b.confirmed},true);break;
 }
 return {confirmed:true};
}
type Dependencies={env:NodeJS.ProcessEnv;verify:(token:string)=>Promise<{uid:string;aud:string;email_verified?:boolean;auth_time?:number}>;authorize:(uid:string)=>void;active:(uid:string)=>Promise<boolean>;read:(uid:string,view:string,id:string|undefined)=>Promise<unknown>;execute:(uid:string,input:unknown)=>Promise<unknown>};
const defaults:Dependencies={env:process.env,verify:token=>adminAuth.verifyIdToken(token,true),authorize:assertEngagementPilotAuthority,active:async uid=>{const u=await adminAuth.getUser(uid);return !u.disabled&&u.emailVerified;},read,execute};
export async function handleFreelanceFinancePilot(req:Request,res:Response,deps:Dependencies=defaults){
 res.setHeader('Cache-Control','private, no-store, max-age=0');res.setHeader('X-Content-Type-Options','nosniff');
 if(!freelanceContractPilotEnabled(deps.env)){res.status(503).json({code:'FREELANCE_FINANCE_DISABLED'});return;}
 if(req.method!=='GET'&&req.method!=='POST'){res.setHeader('Allow','GET, POST');res.status(405).json({code:'METHOD_NOT_ALLOWED'});return;}
 const h=req.headers.authorization,token=typeof h==='string'&&h.length<=8199?/^Bearer (\S+)$/i.exec(h)?.[1]:undefined;
 if(!token){res.status(401).json({code:'AUTH_REQUIRED'});return;}
 let uid:string,authTime:unknown;
 try{const i=await deps.verify(token);if(i.aud!=='kyrub-b8d0e'||i.email_verified!==true||!validFreelanceId(i.uid))throw Error();uid=i.uid;authTime=i.auth_time;}catch{res.status(401).json({code:'AUTH_REQUIRED'});return;}
 if(!freelanceEngagementPilotAllows(uid,deps.env)){res.status(403).json({code:'FREELANCE_FORBIDDEN'});return;}
 try{
  deps.authorize(uid);
  if(!await deps.active(uid)){res.status(403).json({code:'FREELANCE_FORBIDDEN'});return;}
  const q=req.query??{};
  if(req.method==='GET'){
   if(q.view==='restrictions'&&Object.keys(q).length===1){res.status(200).json(await deps.read(uid,q.view,undefined));return;}
   if(typeof q.view!=='string'||!['case','pix_sharing','pix_rebind','pix_withdrawal'].includes(q.view)||Object.keys(q).length!==2||!validFreelanceId(q.offerId))throw Error('FREELANCE_INVALID');
   res.status(200).json(await deps.read(uid,q.view,q.offerId));return;
  }
  if(Object.keys(q).length)throw Error('FREELANCE_INVALID');
  const media=req.headers['content-type'];
  if(typeof media!=='string'||!/^application\/json(?:\s*;|$)/i.test(media)){res.status(415).json({code:'JSON_REQUIRED'});return;}
  if(Buffer.byteLength(JSON.stringify(req.body)??'','utf8')>16384){res.status(413).json({code:'PAYLOAD_TOO_LARGE'});return;}
  const b=validateFinancePilotAction(req.body);
  if(b.action.includes('pix')&&!personalPixRecentLogin(authTime)){res.status(403).json({code:'REAUTHENTICATION_REQUIRED'});return;}
  res.status(200).json(await deps.execute(uid,b));
 }catch(e){
  const code=e instanceof Error?e.message:'';
  const status=code==='FREELANCE_INVALID'?400:['FREELANCE_FORBIDDEN','IDENTITY_VERIFICATION_REQUIRED'].includes(code)?403:['FREELANCE_PIX_DESTINATION_REQUIRED','FREELANCE_PIX_DESTINATION_CHANGED','FREELANCE_PIX_SHARING_REQUIRED','FREELANCE_PIX_DISCLOSURE_UNAVAILABLE','FREELANCE_PAYMENT_NOT_DUE','FREELANCE_PAYMENT_STATEMENT_CONFLICT','FREELANCE_FINANCIAL_REVIEW_CONFLICT','FREELANCE_CONFLICT'].includes(code)?409:503;
  res.status(status).json({code:status===503?'FREELANCE_UNAVAILABLE':code});
 }
}
