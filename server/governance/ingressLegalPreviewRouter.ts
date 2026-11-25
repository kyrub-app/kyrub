import express,{type ErrorRequestHandler} from 'express';
import rateLimit from 'express-rate-limit';
import {ageScreeningEmulatorsReady} from '../identity/ageScreeningRouter.js';
import {readOwnIngressLegalReceipt,recordIngressLegalReceipt} from './ingressLegalReceiptService.js';

/** Loopback-only test transport. Never mount in the production application. */
export function createIngressLegalPreviewRouter(){
 const router=express.Router();
 router.use((req,res,next)=>{
  res.set('Cache-Control','no-store');
  if(!ageScreeningEmulatorsReady(process.env)||process.env.KYRUB_LEGAL_RECEIPT_PREVIEW_ENABLED!=='true'||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress||'')||!/^127\.0\.0\.1(:\d+)?$/.test(req.get('host')||'')){res.sendStatus(404);return;}
  if(req.path!=='/'){res.sendStatus(404);return;}
  if(!['GET','POST'].includes(req.method)){res.set('Allow','GET, POST').sendStatus(405);return;}
  next();
 });
 router.use(rateLimit({windowMs:60000,limit:60,keyGenerator:()=> 'local-legal-preview',standardHeaders:'draft-7',legacyHeaders:false}));
 router.get('/',async(req,res,next)=>{try{res.json(await readOwnIngressLegalReceipt(req.get('authorization')||''));}catch(e){next(e);}});
 router.post('/',express.json({limit:'4kb'}),async(req,res,next)=>{
  if(!req.is('application/json')){res.sendStatus(415);return;}
  try{res.json(await recordIngressLegalReceipt(req.get('authorization')||'',req.body));}catch(e){next(e);}
 });
 const handle:ErrorRequestHandler=(err,_req,res,_next)=>{
  const reason=err instanceof Error?err.message:'';
  if(reason==='LEGAL_AUTH_REQUIRED'||String(err?.code||'').startsWith('auth/'))res.sendStatus(401);
  else if(reason==='LEGAL_DECISION_INVALID'||err?.type==='entity.parse.failed')res.sendStatus(400);
  else if(err?.type==='entity.too.large')res.sendStatus(413);
  else if(reason==='LEGAL_VERSION_CHANGED')res.status(409).json({error:reason});
  else if(reason==='LEGAL_RECEIPT_UNAVAILABLE')res.sendStatus(404);
  else res.sendStatus(503);
 };
 router.use(handle);
 return router;
}
