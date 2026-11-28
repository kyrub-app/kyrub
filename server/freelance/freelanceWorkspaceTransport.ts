import {readStoreReputationManagement} from './freelanceReputationManagementService.js';
import {readOwnReputationForWorkspace,readStoreTeamReputation,readVisibleFreelanceExperience,readAddressFreelanceExperience,readOwnReputationSquarePreview,publishOwnReputationSquare,readReputationSquarePublication,commentReputationSquare,forwardReputationSquare,forwardReputationToConnected,readConnectedReputationCard} from './freelanceReputationIndexAudit.js';
import {readFreelanceReputation,submitFreelanceReputation,readOwnFreelanceReputationContestation,contestFreelanceReputation,readOwnFreelanceReputationProfile,readOwnFreelanceReputationSummary} from './freelanceReputationService.js';
import {readFreelanceExtensions,changeFreelanceExtension} from './freelanceAttendanceExtensionService.js';
import {readFreelanceAttendance,recordFreelanceAttendance} from './freelanceAttendanceService.js';
import {readFreelanceAttendanceSchedule,changeFreelanceAttendanceSchedule} from './freelanceAttendanceScheduleService.js';
import {adminAuth,getFirebaseAdminProjectId} from '../firebaseAdmin.js';
import {validFreelanceId,normalizeFreelanceOffer} from '../../shared/freelanceLifecycle.js';
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
 if(b.action==='forward_reputation_connected'){
  if(Object.keys(b).length!==5||Object.keys(b).some(k=>!['action','offerId','connectionId','recipientId','confirmed'].includes(k)))throw Error('FREELANCE_INVALID');
  return forwardReputationToConnected(uid,b.offerId,b.connectionId,b.recipientId,b.confirmed);
 }
 if(b.action==='forward_reputation_square'){
  if(Object.keys(b).length!==4||Object.keys(b).some(k=>!['action','offerId','destination','confirmed'].includes(k)))throw Error('FREELANCE_INVALID');
  return forwardReputationSquare(uid,b.offerId,b.destination,b.confirmed);
 }
 if(b.action==='comment_reputation_square'){
  if(Object.keys(b).some(k=>!['action','offerId','text','parentCommentId'].includes(k)))throw Error('FREELANCE_INVALID');
  return commentReputationSquare(uid,b.offerId,b.text,b.parentCommentId);
 }
 if(b.action==='publish_reputation_square'){
  if(Object.keys(b).length!==4||Object.keys(b).some(k=>!['action','identifier','requestId','confirmed'].includes(k)))throw Error('FREELANCE_INVALID');
  return publishOwnReputationSquare(uid,b.identifier,b.requestId,b.confirmed);
 }
 if(!validFreelanceId(b.offerId))throw Error('FREELANCE_INVALID');
 const exact=(fields:string[])=>{if(Object.keys(b).some(k=>!['action','offerId',...fields].includes(k)))throw Error('FREELANCE_INVALID');};
 switch(b.action){
 case 'submit_reputation':exact(['confirmed','scores']);return submitFreelanceReputation(uid,b.offerId,{confirmed:b.confirmed,scores:b.scores});
 case 'contest_reputation':exact(['confirmed','ratingDigest','reason']);return contestFreelanceReputation(uid,b.offerId,{confirmed:b.confirmed,ratingDigest:b.ratingDigest,reason:b.reason});
 case 'publish':exact(['terms','requesterStoreId']);{
  const terms=normalizeFreelanceOffer(b.terms);
  if(terms.paymentTerms!==undefined&&(!freelanceWorkspaceEnabled()||process.env.KYRUB_PERSONAL_FINANCE_LOCAL_HOMOLOGATION!=='true'||terms.paymentTerms.method!=='external_pix'))throw Error('FREELANCE_DIRECT_PAYMENT_NOT_ENABLED');
  return lifecycle.publishFreelanceOffer(uid,b.offerId,terms,b.requesterStoreId);
 }
 case 'apply':exact(['expectedPaymentTerms','expectedWorkTerms','counterproposal','expectedRequesterStore']);return lifecycle.applyToFreelanceOffer(uid,b.offerId,{expected:b.expectedPaymentTerms,expectedWorkTerms:b.expectedWorkTerms,expectedRequesterStore:b.expectedRequesterStore,counterproposal:b.counterproposal});
 case 'select':exact(['applicantUid','expectedCounterproposal']);if(!validFreelanceId(b.applicantUid))throw Error('FREELANCE_INVALID');return lifecycle.selectFreelanceApplication(uid,b.offerId,b.applicantUid,b.expectedCounterproposal);
 case 'confirm':exact(['confirmed','expectedPaymentTerms','expectedWorkTerms','expectedRequesterStore']);return lifecycle.confirmFreelanceContract(uid,b.offerId,b.confirmed,{expected:b.expectedPaymentTerms,expectedWorkTerms:b.expectedWorkTerms,expectedRequesterStore:b.expectedRequesterStore});
 case 'propose_extension':exact(['proposalId','extraMinutes','expectedSequence','confirmed']);return changeFreelanceExtension(uid,b.offerId,'propose',{proposalId:b.proposalId,extraMinutes:b.extraMinutes,expectedSequence:b.expectedSequence,confirmed:b.confirmed});
 case 'accept_extension':case 'decline_extension':case 'withdraw_extension':exact(['proposalId','expectedSequence','confirmed']);return changeFreelanceExtension(uid,b.offerId,b.action==='accept_extension'?'accept':b.action==='decline_extension'?'decline':'withdraw',{proposalId:b.proposalId,expectedSequence:b.expectedSequence,confirmed:b.confirmed});
 case 'attendance_event':exact(['kind','eventId','expectedSequence','confirmed']);return recordFreelanceAttendance(uid,b.offerId,{kind:b.kind,eventId:b.eventId,expectedSequence:b.expectedSequence,confirmed:b.confirmed});
 case 'propose_schedule':exact(['proposalId','scheduledStartAt','confirmed']);return changeFreelanceAttendanceSchedule(uid,b.offerId,'propose',{proposalId:b.proposalId,scheduledStartAt:b.scheduledStartAt,confirmed:b.confirmed});
 case 'accept_schedule':case 'decline_schedule':case 'withdraw_schedule':exact(['proposalId','confirmed']);return changeFreelanceAttendanceSchedule(uid,b.offerId,b.action==='accept_schedule'?'accept':b.action==='decline_schedule'?'decline':'withdraw',{proposalId:b.proposalId,confirmed:b.confirmed});
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
type Dependencies={enabled:()=>boolean;verify:(token:string)=>Promise<{uid:string}>;read:(uid:string,view:unknown,offerId?:unknown,cursor?:unknown,storeId?:unknown,targetUid?:unknown,identifier?:unknown)=>Promise<unknown>;mutate:(uid:string,input:unknown)=>Promise<unknown>};
const defaults:Dependencies={enabled:freelanceWorkspaceEnabled,verify:token=>adminAuth.verifyIdToken(token,true),read:(uid,view,offerId,cursor,storeId,targetUid,identifier)=>view==='reputation_connected_card'?(storeId===undefined&&targetUid===undefined&&identifier===undefined?readConnectedReputationCard(uid,offerId,cursor):Promise.reject(Error('FREELANCE_INVALID'))):view==='reputation_square_post'?(cursor===undefined&&storeId===undefined&&targetUid===undefined&&identifier===undefined?readReputationSquarePublication(uid,offerId):Promise.reject(Error('FREELANCE_INVALID'))):view==='reputation_square_preview'?(offerId===undefined&&cursor===undefined&&storeId===undefined&&targetUid===undefined?readOwnReputationSquarePreview(uid,identifier):Promise.reject(Error('FREELANCE_INVALID'))):view==='reputation_public_address_summary'?(offerId===undefined&&cursor===undefined&&storeId===undefined&&targetUid===undefined?readAddressFreelanceExperience(uid,identifier,true):Promise.reject(Error('FREELANCE_INVALID'))):view==='reputation_public_address_experience'?(offerId===undefined&&cursor===undefined&&storeId===undefined&&targetUid===undefined?readAddressFreelanceExperience(uid,identifier):Promise.reject(Error('FREELANCE_INVALID'))):view==='reputation_public_experience'?(offerId===undefined&&cursor===undefined&&storeId===undefined?readVisibleFreelanceExperience(uid,targetUid):Promise.reject(Error('FREELANCE_INVALID'))):view==='reputation_management'?(offerId===undefined?readStoreReputationManagement(uid,storeId,cursor):Promise.reject(Error('FREELANCE_INVALID'))):view==='reputation_team'?(offerId===undefined&&cursor===undefined?readStoreTeamReputation(uid,storeId):Promise.reject(Error('FREELANCE_INVALID'))):view==='reputation_verified_professional'||view==='reputation_verified_personal'||view==='reputation_verified_store'?(offerId===undefined&&cursor===undefined?readOwnReputationForWorkspace(uid,view==='reputation_verified_professional'?'professional':view==='reputation_verified_personal'?'personal_requester':'store_requester').then(({subject,state,projection})=>({subject,state,projection})):Promise.reject(Error('FREELANCE_INVALID'))):view==='reputation_summary_professional'||view==='reputation_summary_personal'||view==='reputation_summary_store'?(offerId===undefined&&cursor===undefined?readOwnFreelanceReputationSummary(uid,view==='reputation_summary_professional'?'professional':view==='reputation_summary_personal'?'personal_requester':'store_requester'):Promise.reject(Error('FREELANCE_INVALID'))):view==='reputation'?(validFreelanceId(offerId)&&cursor===undefined?readFreelanceReputation(uid,offerId):Promise.reject(Error('FREELANCE_INVALID'))):view==='reputation_contestation'?(validFreelanceId(offerId)&&cursor===undefined?readOwnFreelanceReputationContestation(uid,offerId):Promise.reject(Error('FREELANCE_INVALID'))):view==='reputation_professional'||view==='reputation_personal'||view==='reputation_store'?(offerId===undefined?readOwnFreelanceReputationProfile(uid,view==='reputation_professional'?'professional':view==='reputation_personal'?'personal_requester':'store_requester',cursor):Promise.reject(Error('FREELANCE_INVALID'))):view==='attendance_extensions'?(validFreelanceId(offerId)&&!cursor?readFreelanceExtensions(uid,offerId):Promise.reject(Error('FREELANCE_INVALID'))):view==='attendance'?(validFreelanceId(offerId)&&!cursor?readFreelanceAttendance(uid,offerId):Promise.reject(Error('FREELANCE_INVALID'))):view==='attendance_schedule'?(validFreelanceId(offerId)&&!cursor?readFreelanceAttendanceSchedule(uid,offerId):Promise.reject(Error('FREELANCE_INVALID'))):view==='alerts'||view==='earnings'?readFreelancePersonalSummary(uid,view):readFreelanceWorkspace(uid,view,offerId,cursor),mutate:executeFreelanceWorkspaceAction};
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
  if(req.method==='GET'){if(typeof req.query?.view==='string'&&req.query.view.startsWith('reputation')&&Object.keys(req.query).some(k=>!((req.query?.view==='reputation_public_address_experience'||req.query?.view==='reputation_public_address_summary'||req.query?.view==='reputation_square_preview')?['view','identifier']:req.query?.view==='reputation_public_experience'?['view','targetUid']:req.query?.view==='reputation_management'?['view','storeId','cursor']:req.query?.view==='reputation_team'?['view','storeId']:['view','offerId','cursor']).includes(k)))throw Error('FREELANCE_INVALID');res.status(200).json(await deps.read(uid,req.query?.view,req.query?.offerId,req.query?.cursor,req.query?.storeId,req.query?.targetUid,req.query?.identifier));return;}
  const media=req.headers['content-type'];
  if(typeof media!=='string'||!/^application\/json(?:\s*;|$)/i.test(media)){res.status(415).json({code:'JSON_REQUIRED'});return;}
  if(Buffer.byteLength(JSON.stringify(req.body)??'','utf8')>16384){res.status(413).json({code:'PAYLOAD_TOO_LARGE'});return;}
  // Mutations return only an acknowledgement; read access is separately scoped.
  await deps.mutate(uid,req.body);
  res.status(200).json({confirmed:true});
 }catch(e){
  const code=e instanceof Error?e.message:'';
  const status=['FREELANCE_INVALID','FREELANCE_REPUTATION_CRITERIA_INVALID'].includes(code)?400:['FREELANCE_FORBIDDEN','FREELANCE_STORE_FORBIDDEN','IDENTITY_VERIFICATION_REQUIRED'].includes(code)?403:
   ['FREELANCE_REPUTATION_INDEX_CONFLICT','FREELANCE_REPUTATION_CONFLICT','FREELANCE_HOURLY_ACCOUNTING_CONFLICT','FREELANCE_ATTENDANCE_CONFLICT','FREELANCE_WORK_MODE_NOT_ENABLED','FREELANCE_CONFLICT','FREELANCE_FUNDING_REQUIRED','FREELANCE_FUNDING_CONFLICT','FREELANCE_FINANCIAL_BASIS_CONFLICT','FREELANCE_DIRECT_PAYMENT_NOT_ENABLED','FREELANCE_PAYMENT_OBLIGATION_CONFLICT','FREELANCE_FINANCIAL_RESTRICTION','FREELANCE_RESTRICTION_CONFLICT','FREELANCE_PIX_DESTINATION_REQUIRED','FREELANCE_PIX_DESTINATION_CHANGED','FREELANCE_PIX_SHARING_REQUIRED','FREELANCE_ADVANCE_RECEIPT_REQUIRED','FREELANCE_PAYMENT_STATEMENT_CONFLICT','FREELANCE_FINANCIAL_REVIEW_CONFLICT','PERSONAL_PIX_CONFLICT'].includes(code)?409:503;
  res.status(status).json({code:status===503?'FREELANCE_UNAVAILABLE':code});
 }
}
