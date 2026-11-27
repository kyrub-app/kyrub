import {readOwnHourlyReviewNotes,submitHourlyReviewNote,submitHourlyReviewAttachment,readOwnHourlyReviewAttachment} from './freelanceHourlyReviewEvidenceService.js';
import {readVariablePaymentSources} from './freelanceVariablePaymentBasisService.js';
import {prepareCancellationRestriction,prepareExcessRestriction} from './freelanceEngagementRestrictionService.js';
import {readHourlyExcessReview,changeHourlyExcessReview,changeHourlyExcessDispute} from './freelanceHourlyExcessReviewService.js';
import {readHourlyCancellationAgreement,changeHourlyCancellationAgreement,changeHourlyCancellationDispute} from './freelanceHourlyCancellationAgreementService.js';
import {readHourlyCancellation} from './freelanceHourlyCancellationService.js';
import {readCancellationAccounting,changeCancellationAccounting,changeFixedCancellationDispute} from './freelanceCancellationAccountingService.js';
import {adminAuth} from '../firebaseAdmin.js';
import {readOwnFreelanceMovements} from './freelanceMovementsService.js';
import {validFreelanceId} from '../../shared/freelanceLifecycle.js';
import {freelanceWorkspaceEnabled} from './freelanceWorkspaceTransport.js';
import {readFinancialContext,checkedReview,recordFreelanceExternalPaymentStatement,requestFreelanceFinancialReview} from './freelanceExternalPaymentStatementService.js';
import {submitFreelanceFinancialEvidence,readFinancialEvidence} from './freelanceFinancialEvidenceService.js';
import {submitFreelanceFinancialReceipt,readFinancialReceiptManifest,readFinancialReceiptBytes} from './freelanceFinancialReceiptService.js';
import {personalPixRecentLogin} from '../payments/personalPixTransport.js';
import {bindFreelancePixDestination,authorizeFreelancePixSharing,readFreelancePixSharing,revealFreelancePixDestination,changeFreelancePixBinding,readFreelancePixRebind,changeFreelancePixSharingConsent,readFreelancePixWithdrawal} from './freelancePixDestinationService.js';
import {readOwnFreelanceRestrictions,assertFinancialCaseRestrictions} from './freelanceEngagementRestrictionService.js';
import {adminDb} from '../firebaseAdmin.js';

export function freelanceFinanceEnabled(){
 return freelanceWorkspaceEnabled()&&process.env.KYRUB_PERSONAL_FINANCE_LOCAL_HOMOLOGATION==='true';
}
async function readCase(uid:string,offerId:string,receiptId?:string){
 return adminDb.runTransaction(async tx=>{
  const reviewSnapshot=await tx.get(adminDb.doc('freelanceFinancialReviewsV1/'+offerId));
  const offerDoc=await tx.get(adminDb.doc('freelanceOffersV1/'+offerId));
  if(offerDoc.get('status')==='completed'&&offerDoc.get('workTerms.mode')==='hourly'){
   const s=await readVariablePaymentSources(tx,uid,offerId);
   if(s.record.disposition==='no_payment_required'){
    if(receiptId!==undefined)throw Error('FREELANCE_FORBIDDEN');
    const direct=s.c.ref.collection('directPayment'),financial=s.c.ref.collection('financialBasis');
    const incompatible=await tx.getAll(direct.doc('hourlyFinalObligation'),direct.doc('hourlyStatements'),direct.doc('hourlyExcessAgreement'),direct.doc('hourlyExcessResolution'),direct.doc('hourlyExcessDispute'),direct.doc('hourlyCancellationAgreement'),direct.doc('hourlyCancellationResolution'),direct.doc('hourlyCancellationDispute'),financial.doc('hourlyCancellation'),adminDb.doc('freelanceHourlyExcessReviewsV1/'+offerId),adminDb.doc('freelanceHourlyCancellationReviewsV1/'+offerId));
    if(!s.savedBasis.exists||!s.savedCommitment.exists||s.record.finalAmountMinor!==0||s.record.accounting.status!=='calculated'||reviewSnapshot.exists||incompatible.some(x=>x.exists))throw Error('FREELANCE_VARIABLE_PAYMENT_CONFLICT');
    await assertFinancialCaseRestrictions(tx,s.commitment,false);
    await prepareCancellationRestriction(tx,s.commitment,false,false);
    await prepareExcessRestriction(tx,s.commitment,false,false);
    return {offerId,role:uid===s.commitment.requesterUid?'requester':'freelancer',amountMode:'hourly_zero',sourceDigest:s.record.sourceDigest,amountMinor:0,currency:'BRL',timing:'on_completion',operationalStatus:'completed',due:false,financialState:'no_payment_required',hadDisagreement:false,bankVerified:false,restrictionActive:false,reviewStatus:null,reviewOutcome:null,requestedAt:null,statements:[],ownNotes:[],ownReceipts:[],canRequestReview:false,canSubmitEvidence:false};
   }
  }
  const {offer,obligation,events,projection,due,hourlyFinal}=await readFinancialContext(tx,uid,offerId,true);
  const review=checkedReview(reviewSnapshot.data(),obligation);
  const role=uid===obligation.requesterUid?'requester':'freelancer';
  const restricted=projection.state==='disputed'&&review?.status!=='resolved_administratively';
  await assertFinancialCaseRestrictions(tx,obligation,restricted);
  const pending=review?.status==='pending';
  const evidence=pending?await readFinancialEvidence(tx,obligation,review!.requestedAt):{revision:0,notes:[]};
  const receipts=pending?await readFinancialReceiptManifest(tx,obligation,review!.requestedAt):{revision:0,receipts:[]};
  if(receiptId!==undefined){
   if(!pending||!receipts.receipts.some(r=>r.id===receiptId&&r.actorUid===uid))throw Error('FREELANCE_FORBIDDEN');
   return readFinancialReceiptBytes(tx,obligation,review!.requestedAt,receiptId);
  }
  return {offerId,role,...(hourlyFinal?{amountMode:'hourly_final',sourceDigest:hourlyFinal.sourceDigest}:{}),amountMinor:obligation.terms.amountMinor,currency:'BRL',timing:obligation.terms.timing,
   operationalStatus:offer.status,due,financialState:due?projection.state:'not_due',hadDisagreement:projection.hadDisagreement,bankVerified:false,
   restrictionActive:restricted,reviewStatus:review?.status??null,
   reviewOutcome:review?.decision?.outcome??null,requestedAt:review?.requestedAt??null,
   statements:events.map(e=>({role:e.actorUid===uid?role:role==='requester'?'freelancer':'requester',statement:e.statement,recordedAt:e.recordedAt})),
   ownNotes:evidence.notes.filter(n=>n.actorUid===uid).map(n=>({id:n.id,note:n.note,recordedAt:n.recordedAt})),
   ownReceipts:receipts.receipts.filter(r=>r.actorUid===uid).map(r=>({id:r.id,size:r.size,recordedAt:r.recordedAt,mimeType:'image/png'})),
   canRequestReview:restricted&&!review,canSubmitEvidence:pending&&restricted};
 },{readOnly:true});
}
type Request={method?:string;headers:Record<string,string|string[]|undefined>;query?:Record<string,unknown>;body?:unknown};
type Response={setHeader(name:string,value:string):unknown;status(code:number):{json(body:unknown):unknown}};
export async function handleFreelanceFinance(req:Request,res:Response){
 res.setHeader('Cache-Control','private, no-store, max-age=0');res.setHeader('X-Content-Type-Options','nosniff');
 try{if(!freelanceFinanceEnabled())throw Error();}catch{res.status(503).json({code:'FREELANCE_FINANCE_DISABLED'});return;}
 if(req.method!=='GET'&&req.method!=='POST'){res.setHeader('Allow','GET, POST');res.status(405).json({code:'METHOD_NOT_ALLOWED'});return;}
 const h=req.headers.authorization,token=typeof h==='string'&&h.length<=8199?/^Bearer (\S+)$/i.exec(h)?.[1]:undefined;
 if(!token){res.status(401).json({code:'AUTH_REQUIRED'});return;}
 let uid:string,authTime:unknown;
 try{const identity=await adminAuth.verifyIdToken(token,true);uid=identity.uid;authTime=identity.auth_time;if(!validFreelanceId(uid))throw Error();
  if(identity.email_verified!==true){res.status(403).json({code:'FREELANCE_FORBIDDEN'});return;}
 }catch{res.status(401).json({code:'AUTH_REQUIRED'});return;}
 try{
  const q=req.query??{},keys=Object.keys(q);
  if(req.method==='GET'){
   if(q.view==='hourly_review_attachment'&&keys.length===4&&validFreelanceId(q.offerId)&&validFreelanceId(q.attachmentId)&&(q.kind==='cancellation'||q.kind==='excess')){res.status(200).json(await readOwnHourlyReviewAttachment(uid,q.offerId,q.kind,q.attachmentId));return;}
   if(q.view==='hourly_review_notes'&&keys.length===3&&validFreelanceId(q.offerId)&&(q.kind==='cancellation'||q.kind==='excess')){res.status(200).json(await readOwnHourlyReviewNotes(uid,q.offerId,q.kind));return;}
   if(q.view==='hourly_excess_review'&&keys.length===2&&validFreelanceId(q.offerId)){res.status(200).json(await readHourlyExcessReview(uid,q.offerId));return;}
   if(q.view==='hourly_cancellation_agreement'&&keys.length===2&&validFreelanceId(q.offerId)){res.status(200).json(await readHourlyCancellationAgreement(uid,q.offerId));return;}
   if(q.view==='hourly_cancellation'&&keys.length===2&&validFreelanceId(q.offerId)){res.status(200).json(await readHourlyCancellation(uid,q.offerId));return;}
   if(q.view==='cancellation_accounting'&&keys.length===2&&validFreelanceId(q.offerId)){res.status(200).json(await readCancellationAccounting(uid,q.offerId));return;}
   if(q.view==='movements'&&(keys.length===2||keys.length===3)&&keys.every(k=>['view','role','cursor'].includes(k))){res.status(200).json(await readOwnFreelanceMovements(uid,q.role,q.cursor));return;}
   if(q.view==='pix_rebind'&&keys.length===2&&validFreelanceId(q.offerId)){res.status(200).json(await readFreelancePixRebind(uid,q.offerId));return;}
   if(q.view==='pix_withdrawal'&&keys.length===2&&validFreelanceId(q.offerId)){res.status(200).json(await readFreelancePixWithdrawal(uid,q.offerId));return;}
   if(q.view==='pix_sharing'&&keys.length===2&&validFreelanceId(q.offerId)){res.status(200).json(await readFreelancePixSharing(uid,q.offerId));return;}
   if(q.view==='restrictions'&&keys.length===1){res.status(200).json(await readOwnFreelanceRestrictions(uid));return;}
   if(q.view==='case'&&keys.length===2&&validFreelanceId(q.offerId)){res.status(200).json(await readCase(uid,q.offerId));return;}
   if(q.view==='receipt'&&keys.length===3&&validFreelanceId(q.offerId)&&validFreelanceId(q.receiptId)){res.status(200).json(await readCase(uid,q.offerId,q.receiptId));return;}
   throw Error('FREELANCE_INVALID');
  }
  if(keys.length)throw Error('FREELANCE_INVALID');
  const media=req.headers['content-type'];
  if(typeof media!=='string'||!/^application\/json(?:\s*;|$)/i.test(media)){res.status(415).json({code:'JSON_REQUIRED'});return;}
  const b=req.body as Record<string,unknown>|undefined;
  if(!b||typeof b!=='object'||Array.isArray(b)||!validFreelanceId(b.offerId))throw Error('FREELANCE_INVALID');
  const max=['submit_receipt','submit_hourly_review_attachment'].includes(String(b.action))?360*1024:8192;
  if(Buffer.byteLength(JSON.stringify(b),'utf8')>max){res.status(413).json({code:'PAYLOAD_TOO_LARGE'});return;}
  const exact=(fields:string[])=>{if(Object.keys(b).length!==fields.length+2||Object.keys(b).some(k=>!['offerId','action',...fields].includes(k)))throw Error('FREELANCE_INVALID');};
  if(['bind_pix','authorize_pix_share','reveal_pix','propose_pix_rebind','accept_pix_rebind','revoke_pix_share','restore_pix_share','propose_cancellation_accounting','accept_cancellation_accounting','close_cancellation_accounting','propose_hourly_cancellation','accept_hourly_cancellation','decline_hourly_cancellation','withdraw_hourly_cancellation','dispute_hourly_cancellation','request_hourly_cancellation_review','propose_hourly_excess','accept_hourly_excess','decline_hourly_excess','withdraw_hourly_excess','dispute_hourly_excess','request_hourly_excess_review','submit_hourly_review_note','submit_hourly_review_attachment','dispute_fixed_cancellation','request_fixed_cancellation_review'].includes(String(b.action))&&!personalPixRecentLogin(authTime)){res.status(403).json({code:'REAUTHENTICATION_REQUIRED'});return;}
  switch(b.action){
   case 'submit_hourly_review_attachment':exact(['kind','sourceDigest','attachmentId','pngBase64','confirmed']);if(b.kind!=='cancellation'&&b.kind!=='excess')throw Error('FREELANCE_INVALID');await submitHourlyReviewAttachment(uid,b.offerId,b.kind,{sourceDigest:b.sourceDigest,attachmentId:b.attachmentId,pngBase64:b.pngBase64,confirmed:b.confirmed});break;
   case 'submit_hourly_review_note':exact(['kind','sourceDigest','evidenceId','note','confirmed']);if(b.kind!=='cancellation'&&b.kind!=='excess')throw Error('FREELANCE_INVALID');await submitHourlyReviewNote(uid,b.offerId,b.kind,{sourceDigest:b.sourceDigest,evidenceId:b.evidenceId,note:b.note,confirmed:b.confirmed});break;
   case 'dispute_hourly_excess':case 'request_hourly_excess_review':exact(['sourceDigest','confirmed']);await changeHourlyExcessDispute(uid,b.offerId,b.action==='dispute_hourly_excess'?'open':'request_review',{sourceDigest:b.sourceDigest,confirmed:b.confirmed});break;
   case 'propose_hourly_excess':exact(['proposalId','sourceDigest','recognizedExcessMs','confirmed']);await changeHourlyExcessReview(uid,b.offerId,'propose',{proposalId:b.proposalId,sourceDigest:b.sourceDigest,recognizedExcessMs:b.recognizedExcessMs,confirmed:b.confirmed});break;
   case 'accept_hourly_excess':case 'decline_hourly_excess':case 'withdraw_hourly_excess':exact(['proposalId','sourceDigest','confirmed']);await changeHourlyExcessReview(uid,b.offerId,b.action==='accept_hourly_excess'?'accept':b.action==='decline_hourly_excess'?'decline':'withdraw',{proposalId:b.proposalId,sourceDigest:b.sourceDigest,confirmed:b.confirmed});break;
   case 'dispute_hourly_cancellation':case 'request_hourly_cancellation_review':exact(['sourceDigest','confirmed']);await changeHourlyCancellationDispute(uid,b.offerId,b.action==='dispute_hourly_cancellation'?'open':'request_review',{sourceDigest:b.sourceDigest,confirmed:b.confirmed});break;
   case 'propose_hourly_cancellation':exact(['proposalId','sourceDigest','recognizedServiceMinor','confirmed']);await changeHourlyCancellationAgreement(uid,b.offerId,'propose',{proposalId:b.proposalId,sourceDigest:b.sourceDigest,recognizedServiceMinor:b.recognizedServiceMinor,confirmed:b.confirmed});break;
   case 'accept_hourly_cancellation':case 'decline_hourly_cancellation':case 'withdraw_hourly_cancellation':exact(['proposalId','sourceDigest','confirmed']);await changeHourlyCancellationAgreement(uid,b.offerId,b.action==='accept_hourly_cancellation'?'accept':b.action==='decline_hourly_cancellation'?'decline':'withdraw',{proposalId:b.proposalId,sourceDigest:b.sourceDigest,confirmed:b.confirmed});break;
   case 'dispute_fixed_cancellation':case 'request_fixed_cancellation_review':exact(['snapshot','confirmed']);await changeFixedCancellationDispute(uid,b.offerId,b.action==='dispute_fixed_cancellation'?'open':'request_review',{snapshot:b.snapshot,confirmed:b.confirmed});break;
   case 'propose_cancellation_accounting':exact(['proposalId','recognizedServiceMinor','reportedReceivedMinor','confirmed']);await changeCancellationAccounting(uid,b.offerId,'propose',{proposalId:b.proposalId,recognizedServiceMinor:b.recognizedServiceMinor,reportedReceivedMinor:b.reportedReceivedMinor,confirmed:b.confirmed});break;
   case 'accept_cancellation_accounting':
   case 'close_cancellation_accounting':exact(['proposalId','confirmed']);await changeCancellationAccounting(uid,b.offerId,b.action==='accept_cancellation_accounting'?'accept':'close',{proposalId:b.proposalId,confirmed:b.confirmed});break;
   case 'propose_pix_rebind':exact(['oldRevision','newRevision','confirmed']);await changeFreelancePixBinding(uid,b.offerId,'propose',{oldRevision:b.oldRevision,newRevision:b.newRevision,confirmed:b.confirmed});break;
   case 'accept_pix_rebind':exact(['oldRevision','newRevision','confirmed','paymentNotSent']);await changeFreelancePixBinding(uid,b.offerId,'accept',{oldRevision:b.oldRevision,newRevision:b.newRevision,confirmed:b.confirmed,paymentNotSent:b.paymentNotSent});break;
   case 'revoke_pix_share':
   case 'restore_pix_share':exact(['expectedRevision','expectedSequence','confirmed']);await changeFreelancePixSharingConsent(uid,b.offerId,b.action==='revoke_pix_share'?'revoke':'restore',{expectedRevision:b.expectedRevision,expectedSequence:b.expectedSequence,confirmed:b.confirmed});break;
   case 'bind_pix':exact(['expectedRevision','confirmed']);await bindFreelancePixDestination(uid,b.offerId,{expectedRevision:b.expectedRevision,confirmed:b.confirmed});break;
   case 'authorize_pix_share':exact(['expectedRevision','confirmed']);await authorizeFreelancePixSharing(uid,b.offerId,{expectedRevision:b.expectedRevision,confirmed:b.confirmed});break;
   case 'reveal_pix':exact(['expectedRevision','confirmed']);res.status(200).json(await revealFreelancePixDestination(uid,b.offerId,{expectedRevision:b.expectedRevision,confirmed:b.confirmed}));return;
   case 'statement':{const hourly='expectedAmountMinor' in b||'sourceDigest' in b;exact(hourly?['eventId','statement','confirmed','expectedAmountMinor','sourceDigest']:['eventId','statement','confirmed']);await recordFreelanceExternalPaymentStatement(uid,b.offerId,{eventId:b.eventId,statement:b.statement,confirmed:b.confirmed,...(hourly?{expectedAmountMinor:b.expectedAmountMinor,sourceDigest:b.sourceDigest}:{})});break;}
   case 'request_review':exact(['confirmed']);await requestFreelanceFinancialReview(uid,b.offerId,{confirmed:b.confirmed});break;
   case 'submit_note':exact(['evidenceId','note','confirmed']);await submitFreelanceFinancialEvidence(uid,b.offerId,{evidenceId:b.evidenceId,note:b.note,confirmed:b.confirmed});break;
   case 'submit_receipt':exact(['receiptId','pngBase64','confirmed']);await submitFreelanceFinancialReceipt(uid,b.offerId,{receiptId:b.receiptId,pngBase64:b.pngBase64,confirmed:b.confirmed});break;
   default:throw Error('FREELANCE_INVALID');
  }
  res.status(200).json({confirmed:true});
 }catch(e){
  const code=e instanceof Error?e.message:'';
  const status=['FREELANCE_INVALID','FREELANCE_RECEIPT_INVALID'].includes(code)?400:
   ['FREELANCE_FORBIDDEN','IDENTITY_VERIFICATION_REQUIRED'].includes(code)?403:
   ['FREELANCE_VARIABLE_PAYMENT_CONFLICT','FREELANCE_CANCELLATION_ACCOUNTING_CONFLICT','FREELANCE_PAYMENT_NOT_DUE','FREELANCE_PAYMENT_STATEMENT_CONFLICT','FREELANCE_PAYMENT_OBLIGATION_CONFLICT','FREELANCE_FINANCIAL_BASIS_CONFLICT','FREELANCE_FINANCIAL_REVIEW_CONFLICT','FREELANCE_FINANCIAL_EVIDENCE_CONFLICT','FREELANCE_RESTRICTION_CONFLICT','FREELANCE_PIX_DESTINATION_REQUIRED','FREELANCE_PIX_DESTINATION_CHANGED','FREELANCE_PIX_DISCLOSURE_UNAVAILABLE','PERSONAL_PIX_CONFLICT'].includes(code)?409:503;
  res.status(status).json({code:status===503?'FREELANCE_FINANCE_UNAVAILABLE':code});
 }
}
