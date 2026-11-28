import {listFreelanceReputationContests} from './freelanceReputationReviewService.js';
import {listFixedAdjustmentReviews,decideFixedAdjustmentReview,getFixedAdjustmentAttachment} from './freelanceFixedAdjustmentReviewService.js';
import {listFixedCancellationReviews,decideFixedCancellationReview,getFixedCancellationAttachment} from './freelanceFixedCancellationReviewService.js';
import {listHourlyExcessReviews,decideHourlyExcessReview,getHourlyExcessAttachment} from './freelanceHourlyExcessReviewService.js';
import {listHourlyCancellationReviews,decideHourlyCancellationReview,getHourlyCancellationAttachment} from './freelanceHourlyCancellationReviewService.js';
import {financialReviewAdminPilotEnabled,financialReviewAdminEnabled,listFreelanceFinancialReviews,decideFreelanceFinancialReview,getFreelanceFinancialReceipt} from './freelanceFinancialReviewService.js';
type Request={method?:string;headers:Record<string,string|string[]|undefined>;query?:Record<string,unknown>;body?:unknown};
type Response={setHeader(name:string,value:string):unknown;status(code:number):{json(body:unknown):unknown}};
export async function handleFreelanceFinancialReview(req:Request,res:Response){
 res.setHeader('Cache-Control','private, no-store, max-age=0');
 res.setHeader('X-Content-Type-Options','nosniff');
 const pilot=!!(process.env.VERCEL||process.env.VERCEL_ENV);
 try{if(!(pilot?financialReviewAdminPilotEnabled():financialReviewAdminEnabled()))throw Error('DISABLED');}catch{res.status(503).json({code:'FREELANCE_FINANCIAL_REVIEW_DISABLED'});return;}
 if(req.method!=='GET'&&req.method!=='POST'){res.setHeader('Allow','GET, POST');res.status(405).json({code:'METHOD_NOT_ALLOWED'});return;}
 const h=req.headers.authorization;
 if(typeof h!=='string'||h.length>8199||!/^Bearer [^\s]+$/i.test(h)){res.status(401).json({code:'AUTH_REQUIRED'});return;}
 const q=req.query??{},keys=Object.keys(q),attachment=q.view==='hourly_attachment',receipt=q.view==='receipt',cancellation=q.view==='hourly_cancellation',excess=q.view==='hourly_excess',fixed=q.view==='fixed_cancellation',adjustment=q.view==='fixed_adjustment',reputation=q.view==='reputation_contests';
 if(pilot&&req.method==='GET'&&!receipt&&keys.some(k=>k!=='cursor')){res.status(400).json({code:'FREELANCE_INVALID'});return;}
 if(req.method==='POST'?keys.length!==0:attachment?(keys.length!==4||keys.some(k=>!['view','kind','offerId','attachmentId'].includes(k))||!['cancellation','excess','fixed_cancellation','fixed_adjustment'].includes(String(q.kind))):receipt?(keys.length!==3||keys.some(k=>!['view','offerId','receiptId'].includes(k))):(cancellation||excess||fixed||adjustment||reputation)?keys.some(k=>!['cursor','view'].includes(k)):keys.some(k=>k!=='cursor')){res.status(400).json({code:'FREELANCE_INVALID'});return;}
 try{
  if(req.method==='GET'){res.status(200).json(attachment?(q.kind==='fixed_adjustment'?await getFixedAdjustmentAttachment(h,q.offerId,q.attachmentId):q.kind==='fixed_cancellation'?await getFixedCancellationAttachment(h,q.offerId,q.attachmentId):q.kind==='cancellation'?await getHourlyCancellationAttachment(h,q.offerId,q.attachmentId):await getHourlyExcessAttachment(h,q.offerId,q.attachmentId)):receipt?await getFreelanceFinancialReceipt(h,q.offerId,q.receiptId,pilot):reputation?await listFreelanceReputationContests(h,q.cursor):adjustment?await listFixedAdjustmentReviews(h,q.cursor):fixed?await listFixedCancellationReviews(h,q.cursor):excess?await listHourlyExcessReviews(h,q.cursor):cancellation?await listHourlyCancellationReviews(h,q.cursor):await listFreelanceFinancialReviews(h,q.cursor,pilot));return;}
  const media=req.headers['content-type'];
  if(typeof media!=='string'||!/^application\/json(?:\s*;|$)/i.test(media)){res.status(415).json({code:'JSON_REQUIRED'});return;}
  if(Buffer.byteLength(JSON.stringify(req.body)??'','utf8')>8192){res.status(413).json({code:'PAYLOAD_TOO_LARGE'});return;}
  const body=req.body as Record<string,unknown>|undefined;
  if(pilot){res.status(200).json(await decideFreelanceFinancialReview(h,req.body,true));return;}
  if(body?.action==='decide_fixed_adjustment'){const {action,...input}=body;res.status(200).json(await decideFixedAdjustmentReview(h,input));return;}
  if(body?.action==='decide_fixed_cancellation'){const {action,...input}=body;res.status(200).json(await decideFixedCancellationReview(h,input));return;}
  if(body?.action==='decide_hourly_excess'){const {action,...input}=body;res.status(200).json(await decideHourlyExcessReview(h,input));return;}
  if(body?.action==='decide_hourly_cancellation'){const {action,...input}=body;res.status(200).json(await decideHourlyCancellationReview(h,input));return;}
  res.status(200).json(await decideFreelanceFinancialReview(h,req.body));
 }
 catch(e){
  const code=e instanceof Error?e.message:'';
  const status=['second_factor_required','reauthentication_required','FORBIDDEN','FREELANCE_FORBIDDEN'].includes(code)?403:
   ['authentication_required','AUTH_REQUIRED'].includes(code)||code.startsWith('Firebase ID token')?401:code==='FREELANCE_INVALID'?400:
   ['FREELANCE_REPUTATION_CONFLICT','FREELANCE_FINANCIAL_REVIEW_CONFLICT','FREELANCE_RESTRICTION_CONFLICT','FREELANCE_PAYMENT_OBLIGATION_CONFLICT','FREELANCE_VARIABLE_PAYMENT_CONFLICT','FREELANCE_FINANCIAL_EVIDENCE_CONFLICT','FREELANCE_CANCELLATION_ACCOUNTING_CONFLICT','FREELANCE_PAYMENT_STATEMENT_CONFLICT'].includes(code)?409:503;
  res.status(status).json({code:status===503?'FREELANCE_FINANCIAL_REVIEW_UNAVAILABLE':status===401?'AUTH_REQUIRED':code});
 }
}
