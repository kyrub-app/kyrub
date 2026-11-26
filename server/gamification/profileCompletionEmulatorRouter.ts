import express from 'express';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { profileCompletionPilotEnabled, reconcileIsolatedProfileCompletionAfterSave } from './profileCompletionAwardPilot.js';

export function createProfileCompletionEmulatorRouter(db:Firestore,auth:Auth){
 const router=express.Router();
 router.all('/profile-completion-pilot',async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  if(!profileCompletionPilotEnabled(db)||auth.app.options.projectId!=='demo-kyrub-welcome'||
   !['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress||'')||
   !/^127\.0\.0\.1(:\d+)?$/.test(req.get('host')||'')){
   res.sendStatus(404);return;
  }
  if(req.method!=='POST'){res.set('Allow','POST').sendStatus(405);return;}
  if(Object.keys(req.query).length||!req.body||typeof req.body!=='object'||Array.isArray(req.body)||Object.keys(req.body).length){
   res.status(400).json({error:'PROFILE_COMPLETION_INPUT_INVALID'});return;
  }
  const token=/^Bearer (\S+)$/i.exec(req.get('authorization')||'')?.[1];
  if(!token){res.sendStatus(401);return;}
  try{
   const award=await reconcileIsolatedProfileCompletionAfterSave(db,auth,token);
   res.json({status:award.replay?'already_completed':'completed'});
  }catch(error){
   const code=error instanceof Error?error.message:'';
   if(code==='PROFILE_COMPLETION_AUTH_INVALID'){res.sendStatus(401);return;}
   if(['PROFILE_COMPLETION_NOT_ELIGIBLE','PROFILE_COMPLETION_AGE_REQUIRED','PROFILE_COMPLETION_BALANCE_UNAVAILABLE','PROFILE_COMPLETION_DEFINITION_INVALID'].includes(code)){
    res.json({status:'pending'});return;
   }
   res.status(503).json({error:'PROFILE_COMPLETION_UNAVAILABLE'});
  }
 });
 return router;
}
