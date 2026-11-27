import {adminAuth} from '../firebaseAdmin.js';
import {readOwnFreelanceMovements} from './freelanceMovementsService.js';
import {validFreelanceId} from '../../shared/freelanceLifecycle.js';
import {freelanceWorkspaceEnabled} from './freelanceWorkspaceTransport.js';
import {readFinancialContext,checkedReview,recordFreelanceExternalPaymentStatement,requestFreelanceFinancialReview} from './freelanceExternalPaymentStatementService.js';
import {submitFreelanceFinancialEvidence,readFinancialEvidence} from './freelanceFinancialEvidenceService.js';
import {submitFreelanceFinancialReceipt,readFinancialReceiptManifest,readFinancialReceiptBytes} from './freelanceFinancialReceiptService.js';
import {bindFreelancePixDestination} from './freelancePixDestinationService.js';
import {readOwnFreelanceRestrictions,assertFinancialCaseRestrictions} from './freelanceEngagementRestrictionService.js';
import {adminDb} from '../firebaseAdmin.js';

export function freelanceFinanceEnabled(){
 return freelanceWorkspaceEnabled()&&process.env.KYRUB_PERSONAL_FINANCE_LOCAL_HOMOLOGATION==='true';
}
async function readCase(uid:string,offerId:string,receiptId?:string){
 return adminDb.runTransaction(async tx=>{
  const reviewSnapshot=await tx.get(adminDb.doc('freelanceFinancialReviewsV1/'+offerId));
  const {offer,obligation,events,projection}=await readFinancialContext(tx,uid,offerId);
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
  return {offerId,role,amountMinor:obligation.terms.amountMinor,currency:'BRL',timing:obligation.terms.timing,
   operationalStatus:offer.status,financialState:projection.state,hadDisagreement:projection.hadDisagreement,bankVerified:false,
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
 let uid:string;
 try{const identity=await adminAuth.verifyIdToken(token,true);uid=identity.uid;if(!validFreelanceId(uid))throw Error();
  if(identity.email_verified!==true){res.status(403).json({code:'FREELANCE_FORBIDDEN'});return;}
 }catch{res.status(401).json({code:'AUTH_REQUIRED'});return;}
 try{
  const q=req.query??{},keys=Object.keys(q);
  if(req.method==='GET'){
   if(q.view==='movements'&&(keys.length===2||keys.length===3)&&keys.every(k=>['view','role','cursor'].includes(k))){res.status(200).json(await readOwnFreelanceMovements(uid,q.role,q.cursor));return;}
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
  const max=b.action==='submit_receipt'?360*1024:8192;
  if(Buffer.byteLength(JSON.stringify(b),'utf8')>max){res.status(413).json({code:'PAYLOAD_TOO_LARGE'});return;}
  const exact=(fields:string[])=>{if(Object.keys(b).length!==fields.length+2||Object.keys(b).some(k=>!['offerId','action',...fields].includes(k)))throw Error('FREELANCE_INVALID');};
  switch(b.action){
   case 'bind_pix':exact(['expectedRevision','confirmed']);await bindFreelancePixDestination(uid,b.offerId,{expectedRevision:b.expectedRevision,confirmed:b.confirmed});break;
   case 'statement':exact(['eventId','statement','confirmed']);await recordFreelanceExternalPaymentStatement(uid,b.offerId,{eventId:b.eventId,statement:b.statement,confirmed:b.confirmed});break;
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
   ['FREELANCE_PAYMENT_NOT_DUE','FREELANCE_PAYMENT_STATEMENT_CONFLICT','FREELANCE_PAYMENT_OBLIGATION_CONFLICT','FREELANCE_FINANCIAL_BASIS_CONFLICT','FREELANCE_FINANCIAL_REVIEW_CONFLICT','FREELANCE_FINANCIAL_EVIDENCE_CONFLICT','FREELANCE_RESTRICTION_CONFLICT','FREELANCE_PIX_DESTINATION_REQUIRED','FREELANCE_PIX_DESTINATION_CHANGED','PERSONAL_PIX_CONFLICT'].includes(code)?409:503;
  res.status(status).json({code:status===503?'FREELANCE_FINANCE_UNAVAILABLE':code});
 }
}
