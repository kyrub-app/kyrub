import express from 'express';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { semeaduraEconomicPilotEnabled } from './semeaduraEconomicPilot.js';
import {
 listIsolatedGamificationSuspicionCases, readIsolatedGamificationSuspicionCase,
 readIsolatedGamificationIncrementalSnapshot, openIsolatedGamificationSuspicionCase,
 closeIsolatedGamificationSuspicionCase, listIsolatedGamificationEconomicReferrals,
 readIsolatedGamificationEconomicReferral, acceptIsolatedGamificationEconomicReferral, decideIsolatedGamificationEconomicReferral,
 readIsolatedGamificationRelease, changeIsolatedGamificationRelease,
} from './semeaduraAdminSupervision.js';

const safeId=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const loopback=(v:string|undefined)=>v==='127.0.0.1'||v==='::1'||v==='::ffff:127.0.0.1';

/** Test/local harness only. Not mounted in the application or Vercel.
 * Never accept forwarded IP, origin, user identity or role as authority.
 * Optional case lifecycle writes under an additional fixture flag; no economic writes. */
export function createIsolatedGamificationAdminRouter(db:Firestore,auth:Auth){
 const router=express.Router();
 router.use((req,res,next)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Vary','Authorization');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(!semeaduraEconomicPilotEnabled(db)||auth.app.options.projectId!=='demo-kyrub-welcome'||
     process.env.KYRUB_GAMIFICATION_ADMIN_HTTP_PILOT!=='true'||!loopback(req.socket.remoteAddress)){
   res.status(404).json({code:'NOT_AVAILABLE'});return;
  }
  const caseWrites=process.env.KYRUB_GAMIFICATION_ADMIN_CASE_WRITE_PILOT==='true';
  const releaseWrites=process.env.KYRUB_GAMIFICATION_ADMIN_RELEASE_WRITE_PILOT==='true';
  if(req.method!=='GET'&&!(req.method==='POST'&&(caseWrites||releaseWrites))){
   res.setHeader('Allow',caseWrites||releaseWrites?'GET, POST':'GET');res.status(405).json({code:'METHOD_NOT_ALLOWED'});return;
  }
  // Do not support cross-origin calls; only same-origin browser requests or
  // local test clients without an Origin header. No CORS headers are granted.
  if(req.headers.origin&&req.headers.origin!=='http://'+req.headers.host){
   res.status(403).json({code:'ORIGIN_DENIED'});return;
  }
  if(req.originalUrl.length>2048){
   res.status(414).json({code:'INPUT_INVALID'});return;
  }
  if(req.method==='POST'&&(!req.headers.origin||!/^127\.0\.0\.1:\d+$/.test(req.headers.host??'')||
     !req.is('application/json')||Object.keys(req.query).length!==0)){
   res.status(400).json({code:'INPUT_INVALID'});return;
  }
  next();
 });
 router.get('/',async(req,res)=>{
  const q=req.query;
  const allowed=(keys:string[])=>Object.keys(q).every(k=>keys.includes(k));
  const authHeader=typeof req.headers.authorization==='string'?req.headers.authorization:'';
  try{
   if(q.operation==='release'&&allowed(['operation'])){
    res.json(await readIsolatedGamificationRelease(db,auth,authHeader));return;
   }
   if(q.operation==='snapshot'&&allowed(['operation'])){
    res.json(await readIsolatedGamificationIncrementalSnapshot(db,auth,authHeader));return;
   }
   if(q.operation==='cases'&&allowed(['operation','status','limit','afterCaseId'])&&
      (q.status==='all'||q.status==='open'||q.status==='closed')&&
      typeof q.limit==='string'&&/^(?:[1-9]|1[0-9]|20)$/.test(q.limit)&&
      (q.afterCaseId===undefined||safeId(q.afterCaseId))){
    res.json(await listIsolatedGamificationSuspicionCases(db,auth,authHeader,
      {status:q.status,limit:Number(q.limit),afterCaseId:q.afterCaseId as string|undefined}));return;
   }
   if(q.operation==='referrals'&&allowed(['operation','limit','afterCaseId'])&&
      typeof q.limit==='string'&&/^(?:[1-9]|10)$/.test(q.limit)&&
      (q.afterCaseId===undefined||safeId(q.afterCaseId))){
    res.json(await listIsolatedGamificationEconomicReferrals(db,auth,authHeader,{limit:Number(q.limit),afterCaseId:q.afterCaseId as string|undefined}));return;
   }
   if(q.operation==='referral'&&allowed(['operation','caseId'])&&safeId(q.caseId)){
    res.json(await readIsolatedGamificationEconomicReferral(db,auth,authHeader,q.caseId));return;
   }
   if(q.operation==='case'&&allowed(['operation','caseId'])&&safeId(q.caseId)){
    res.json(await readIsolatedGamificationSuspicionCase(db,auth,authHeader,q.caseId));return;
   }
   res.status(400).json({code:'INPUT_INVALID'});
  }catch(error){
   const message=error instanceof Error?error.message:'';
   if(message==='GAMIFICATION_SUPERVISION_AUTH_REQUIRED'){res.status(401).json({code:'AUTH_REQUIRED'});return;}
   if(message==='GAMIFICATION_SUPERVISION_FORBIDDEN'){res.status(403).json({code:'FORBIDDEN'});return;}
   if(message==='GAMIFICATION_SUPERVISION_DISABLED'){res.status(404).json({code:'NOT_AVAILABLE'});return;}
   if(message==='SUSPICION_CASE_UNAVAILABLE'){res.status(404).json({code:'CASE_UNAVAILABLE'});return;}
   // No raw errors, credentials, document paths or internal diagnostics.
   res.status(503).json({code:'SUPERVISION_UNAVAILABLE'});
  }
 });
 router.post('/',express.json({limit:'2kb',strict:true}),async(req,res)=>{
  const body=req.body;
  if(!body||typeof body!=='object'||Array.isArray(body)||body.confirmed!==true){
   res.status(400).json({code:'INPUT_INVALID'});return;
  }
  const allowed=(keys:string[])=>Object.keys(body).every(k=>keys.includes(k));
  const authorization=typeof req.headers.authorization==='string'?req.headers.authorization:'';
  try{
   if(body.operation==='release_change'){
    if(process.env.KYRUB_GAMIFICATION_ADMIN_RELEASE_WRITE_PILOT!=='true'){res.status(404).json({code:'NOT_AVAILABLE'});return;}
    if(!allowed(['operation','confirmed','eventId','expectedRevision','status','reason'])||!safeId(body.eventId)||
      !Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<1||
      !['open','paused'].includes(body.status)||typeof body.reason!=='string'||body.reason.trim().length<10||body.reason.length>500){
     res.status(400).json({code:'INPUT_INVALID'});return;
    }
    res.json(await changeIsolatedGamificationRelease(db,auth,authorization,{eventId:body.eventId,expectedRevision:body.expectedRevision,status:body.status,reason:body.reason}));return;
   }
   if(process.env.KYRUB_GAMIFICATION_ADMIN_CASE_WRITE_PILOT!=='true'){res.status(404).json({code:'NOT_AVAILABLE'});return;}
   if(!safeId(body.caseId)){res.status(400).json({code:'INPUT_INVALID'});return;}
   if(body.operation==='accept_referral'||body.operation==='decide_referral'){
    if(process.env.KYRUB_GAMIFICATION_ADMIN_REFERRAL_WRITE_PILOT!=='true'){
     res.status(404).json({code:'NOT_AVAILABLE'});return;
    }
    if(body.operation==='accept_referral'&&allowed(['operation','caseId','confirmed'])){
     res.json(await acceptIsolatedGamificationEconomicReferral(db,auth,authorization,body.caseId));return;
    }
    if(body.operation==='decide_referral'&&allowed(['operation','caseId','decision','reason','confirmed'])&&
       ['no_action','insufficient_evidence','requires_separate_corrective_review'].includes(body.decision)&&
       typeof body.reason==='string'&&body.reason.trim().length>=10&&body.reason.length<=500){
     res.json(await decideIsolatedGamificationEconomicReferral(db,auth,authorization,{caseId:body.caseId,decision:body.decision,reason:body.reason}));return;
    }
    res.status(400).json({code:'INPUT_INVALID'});return;
   }
   if(body.operation==='open'&&allowed(['operation','caseId','kind','postId','confirmed'])&&
      (body.kind==='personal'||body.kind==='community')&&typeof body.postId==='string'&&
      /^[A-Za-z0-9_-]{1,500}$/.test(body.postId)){
    res.json(await openIsolatedGamificationSuspicionCase(db,auth,authorization,
      {caseId:body.caseId,kind:body.kind,postId:body.postId}));return;
   }
   if(body.operation==='close'&&allowed(['operation','caseId','outcome','confirmed'])&&
      ['resolved','inconclusive','referred_for_review'].includes(body.outcome)){
    res.json(await closeIsolatedGamificationSuspicionCase(db,auth,authorization,
      {caseId:body.caseId,outcome:body.outcome}));return;
   }
   res.status(400).json({code:'INPUT_INVALID'});
  }catch(error){
   const message=error instanceof Error?error.message:'';
   if(message==='GAMIFICATION_SUPERVISION_AUTH_REQUIRED'){res.status(401).json({code:'AUTH_REQUIRED'});return;}
   if(message==='GAMIFICATION_SUPERVISION_FORBIDDEN'){res.status(403).json({code:'FORBIDDEN'});return;}
   if(message==='GAMIFICATION_SUPERVISION_DISABLED'||message==='SUSPICION_CASE_UNAVAILABLE'){res.status(404).json({code:'NOT_AVAILABLE'});return;}
   if(message==='RELEASE_CONTROL_INPUT_INVALID'){res.status(400).json({code:'INPUT_INVALID'});return;}
   if(['RELEASE_CONTROL_INVALID','RELEASE_CONTROL_EVENT_CONFLICT','RELEASE_CONTROL_REVISION_CONFLICT','RELEASE_CONTROL_TRANSITION_INVALID','RELEASE_CONTROL_RESUME_BLOCKED'].includes(message)){res.status(409).json({code:message});return;}
   if(['SUSPICION_CASE_NO_INDICATORS','SUSPICION_CASE_NOT_RESOLVED','SUSPICION_CASE_ALREADY_OPEN','SUSPICION_CASE_ID_CONFLICT','SUSPICION_CASE_CLOSE_CONFLICT','ECONOMIC_REFERRAL_DECISION_CONFLICT','ECONOMIC_REFERRAL_SOURCE_INVALID'].includes(message)){
    res.status(409).json({code:message});return;
   }
   res.status(503).json({code:'SUPERVISION_UNAVAILABLE'});
  }
 });
 router.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
  void error;res.status(400).json({code:'INPUT_INVALID'});
 });
 router.use((_req,res)=>{res.status(404).json({code:'NOT_AVAILABLE'});});
 return router;
}
