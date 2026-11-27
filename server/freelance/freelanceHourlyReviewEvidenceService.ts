import {appendHourlyAttachment,readHourlyAttachment,projectHourlyAttachments} from './freelanceHourlyReviewNotes.js';
import {sanitizeReceiptPng} from './freelanceReceiptPng.js';
import {adminDb} from '../firebaseAdmin.js';
import {validFreelanceId} from '../../shared/freelanceLifecycle.js';
import {readHourlyCancellationAgreementContext} from './freelanceHourlyCancellationAgreementService.js';
import {readHourlyExcessContext} from './freelanceHourlyExcessReviewService.js';
import {appendHourlyReviewNote,normalizeHourlyReviewNote,projectHourlyReviewNotes,type HourlyReviewKind} from './freelanceHourlyReviewNotes.js';
const fail=():never=>{throw Error('FREELANCE_FINANCIAL_EVIDENCE_CONFLICT');};
export async function readOwnHourlyReviewNotes(uid:string,id:string,kind:HourlyReviewKind){
 return adminDb.runTransaction(async tx=>{
  const c=kind==='cancellation'?await readHourlyCancellationAgreementContext(tx,uid,id):await readHourlyExcessContext(tx,uid,id);
  if(!c.dispute?.requestedAt)return fail();
  return {offerId:id,kind,sourceDigest:c.record.sourceDigest,canSubmit:c.restricted&&c.dispute.status==='review_requested',notes:projectHourlyReviewNotes(c.evidence.notes,c.record.commitment,uid),attachments:projectHourlyAttachments(c.evidence.attachments,c.record.commitment,uid)};
 },{readOnly:true});
}
export async function submitHourlyReviewNote(uid:string,id:string,kind:HourlyReviewKind,input:{sourceDigest:unknown;evidenceId:unknown;note:unknown;confirmed:unknown}){
 if(input.confirmed!==true||!validFreelanceId(input.evidenceId)||typeof input.sourceDigest!=='string'||!/^[a-f0-9]{64}$/.test(input.sourceDigest))throw Error('FREELANCE_INVALID');
 const evidenceId=input.evidenceId,note=normalizeHourlyReviewNote(input.note);
 return adminDb.runTransaction(async tx=>{
  const c=kind==='cancellation'?await readHourlyCancellationAgreementContext(tx,uid,id):await readHourlyExcessContext(tx,uid,id);
  if(!c.restricted||c.dispute?.status!=='review_requested'||!c.dispute.requestedAt||c.record.sourceDigest!==input.sourceDigest)return fail();
  return appendHourlyReviewNote(tx,c.evidence,c.record.commitment,c.record.sourceDigest,c.dispute.requestedAt,uid,evidenceId,note);
 });
}

export async function submitHourlyReviewAttachment(uid:string,id:string,kind:HourlyReviewKind,input:{sourceDigest:unknown;attachmentId:unknown;pngBase64:unknown;confirmed:unknown}){
 if(input.confirmed!==true||!validFreelanceId(input.attachmentId)||typeof input.sourceDigest!=='string'||!/^[a-f0-9]{64}$/.test(input.sourceDigest))throw Error('FREELANCE_INVALID');
 const attachmentId=input.attachmentId,clean=sanitizeReceiptPng(input.pngBase64);
 return adminDb.runTransaction(async tx=>{
  const c=kind==='cancellation'?await readHourlyCancellationAgreementContext(tx,uid,id):await readHourlyExcessContext(tx,uid,id);
  if(!c.restricted||c.dispute?.status!=='review_requested'||!c.dispute.requestedAt||c.record.sourceDigest!==input.sourceDigest)return fail();
  return appendHourlyAttachment(tx,c.evidence,c.record.commitment,c.record.sourceDigest,c.dispute.requestedAt,uid,attachmentId,clean);
 });
}
export async function readOwnHourlyReviewAttachment(uid:string,id:string,kind:HourlyReviewKind,attachmentId:string){
 return adminDb.runTransaction(async tx=>{
  const c=kind==='cancellation'?await readHourlyCancellationAgreementContext(tx,uid,id):await readHourlyExcessContext(tx,uid,id);
  if(!c.dispute?.requestedAt)return fail();
  return readHourlyAttachment(tx,c.evidence,attachmentId,uid);
 },{readOnly:true});
}
