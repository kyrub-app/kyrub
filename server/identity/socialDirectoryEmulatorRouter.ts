import express from 'express';
import type {Auth} from 'firebase-admin/auth';
import type {Firestore} from 'firebase-admin/firestore';
import {isDocumentId} from './publicSocialAddressPolicy.js';
import {consumeDirectoryQuota} from './directoryQuotaService.js';
import {readVisibleSocialDirectoryPage,readVisibleAuthorIdentities,searchVisibleNoteCollaborators} from './socialDiscoveryDirectoryService.js';

const PROJECT='demo-kyrub-welcome';
export function socialDirectoryPilotEnabled(db:Firestore,env:NodeJS.ProcessEnv=process.env){
 return env.KYRUB_SOCIAL_DIRECTORY_PILOT==='true'&&env.NODE_ENV==='test'&&
 (db as Firestore&{projectId?:string}).projectId===PROJECT&&
 env.GCLOUD_PROJECT===PROJECT&&env.GOOGLE_CLOUD_PROJECT===PROJECT&&
 env.FIRESTORE_EMULATOR_HOST==='127.0.0.1:8088'&&env.FIREBASE_AUTH_EMULATOR_HOST==='127.0.0.1:9099'&&
 !env.VERCEL&&!env.FIREBASE_SERVICE_ACCOUNT_JSON&&!env.GOOGLE_APPLICATION_CREDENTIALS;
}

/** Local-only pilot. Shared transactional quota, no production route. */
export function createSocialDirectoryEmulatorRouter(db:Firestore,auth:Auth){
 const router=express.Router();
 router.all('/social-directory-pilot/:operation',async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  if(!socialDirectoryPilotEnabled(db)||auth.app.options.projectId!==PROJECT||
   !['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress||'')||
   !/^127\.0\.0\.1(:\d+)?$/.test(req.get('host')||'')){res.sendStatus(404);return;}
  if(req.method!=='POST'){res.set('Allow','POST').sendStatus(405);return;}
  const op=req.params.operation;
  if(op!=='page'&&op!=='authors'&&op!=='collaborators'){res.sendStatus(404);return;}
  const token=/^Bearer (\S+)$/i.exec(req.get('authorization')||'')?.[1];
  if(!token||token.length>8192){res.sendStatus(401);return;}
  let uid:string;
  try{
   const identity=await auth.verifyIdToken(token,true);
   if(identity.aud!==PROJECT||identity.email_verified!==true||!isDocumentId(identity.uid))throw Error('AUTH_INVALID');
   const actor=await auth.getUser(identity.uid);
   if(actor.disabled||!actor.emailVerified)throw Error('AUTH_INVALID');
   uid=identity.uid;
  }catch{res.sendStatus(401);return;}
  try{
   const quota=await consumeDirectoryQuota(db,uid,'social');
   if(quota.allowed===false){res.set('Retry-After',String(quota.retryAfterSeconds)).sendStatus(429);return;}
  }catch{res.status(503).json({error:'DIRECTORY_UNAVAILABLE'});return;}
  const body=req.body;
  if(Object.keys(req.query).length||!body||typeof body!=='object'||Array.isArray(body)||
   (op==='page'?(Object.keys(body).some(k=>k!=='after')||('after' in body&&!isDocumentId(body.after))):
   op==='authors'?(Object.keys(body).length!==1||!Array.isArray(body.authorIds)):
   (Object.keys(body).length!==1||typeof body.term!=='string'))){
   res.status(400).json({error:'DIRECTORY_INPUT_INVALID'});return;
  }
  try{
   if(op==='page'){res.json(await readVisibleSocialDirectoryPage(db,uid,body.after));return;}
   if(op==='collaborators'){res.json({entries:await searchVisibleNoteCollaborators(db,auth,uid,body.term)});return;}
   res.json({entries:await readVisibleAuthorIdentities(db,uid,body.authorIds)});
  }catch(error){
   if(error instanceof Error&&error.message==='DIRECTORY_INPUT_INVALID'){res.status(400).json({error:error.message});return;}
   res.status(503).json({error:'DIRECTORY_UNAVAILABLE'});
  }
 });
 return router;
}
