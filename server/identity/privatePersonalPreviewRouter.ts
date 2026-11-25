import express, {type ErrorRequestHandler} from 'express';
import rateLimit from 'express-rate-limit';
import { getFirebaseAdminProjectId } from '../firebaseAdmin.js';
import { ageScreeningEmulatorsReady } from './ageScreeningRouter.js';
import { privatePersonalWorkspace } from './privatePersonalWorkspace.js';

export function createPrivatePersonalPreviewRouter(){
 const router=express.Router();
 router.use((req,res,next)=>{
  res.set('Cache-Control','no-store');
  if(!ageScreeningEmulatorsReady(process.env)||process.env.KYRUB_PERSONAL_PREVIEW_ENABLED!=='true'||
    getFirebaseAdminProjectId()!=='demo-kyrub-onboarding'||
    !['127.0.0.1','::ffff:127.0.0.1','::1'].includes(req.socket.remoteAddress||'')||
    !/^127\.0\.0\.1(:\d+)?$/.test(req.get('host')||'')){res.sendStatus(404);return;}
  next();
 });
 router.use(rateLimit({windowMs:60000,limit:120,keyGenerator:()=> 'local-personal-preview'}));
 router.get('/:kind',async(req,res,next)=>{
  try{
   const kind=req.params.kind;
   if(kind!=='notes'&&kind!=='tasks'){res.sendStatus(404);return;}
   res.json(await privatePersonalWorkspace(req.get('authorization')||'',kind));
  }catch(e){next(e);}
 });
 router.post('/:kind',express.json({limit:'8kb'}),async(req,res,next)=>{
  try{
   const kind=req.params.kind;
   if(kind!=='notes'&&kind!=='tasks'){res.sendStatus(404);return;}
   if(!req.is('application/json')){res.sendStatus(415);return;}
   if(!req.body){res.sendStatus(400);return;}
   res.json(await privatePersonalWorkspace(req.get('authorization')||'',kind,req.body));
  }catch(e){next(e);}
 });
 const error:ErrorRequestHandler=(err,_req,res,_next)=>{
  const reason=err instanceof Error?err.message:'';
  if(reason==='PERSONAL_AUTH_REQUIRED'||String(err?.code||'').startsWith('auth/'))res.sendStatus(401);
  else if(reason==='PERSONAL_FORBIDDEN')res.sendStatus(403);
  else if(reason==='PERSONAL_INVALID'||err?.type==='entity.parse.failed')res.sendStatus(400);
  else if(err?.type==='entity.too.large')res.sendStatus(413);
  else if(reason==='PERSONAL_UNAVAILABLE')res.sendStatus(404);
  else res.sendStatus(503);
 };
 router.use(error);
 return router;
}
