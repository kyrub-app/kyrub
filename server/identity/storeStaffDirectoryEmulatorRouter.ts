import express from 'express';
import type {Auth} from 'firebase-admin/auth';
import type {Firestore} from 'firebase-admin/firestore';
import {isDocumentId} from './publicSocialAddressPolicy.js';
import {consumeDirectoryQuota} from './directoryQuotaService.js';
import {searchStoreStaffDirectory,createStoreStaffInvitation} from './storeStaffDirectoryService.js';

const PROJECT='demo-kyrub-welcome';
export function staffDirectoryPilotEnabled(db:Firestore,env:NodeJS.ProcessEnv=process.env){
 return env.KYRUB_STAFF_DIRECTORY_PILOT==='true'&&env.NODE_ENV==='test'&&
 (db as Firestore&{projectId?:string}).projectId===PROJECT&&
 env.GCLOUD_PROJECT===PROJECT&&env.GOOGLE_CLOUD_PROJECT===PROJECT&&
 env.FIRESTORE_EMULATOR_HOST==='127.0.0.1:8088'&&env.FIREBASE_AUTH_EMULATOR_HOST==='127.0.0.1:9099'&&
 !env.VERCEL&&!env.FIREBASE_SERVICE_ACCOUNT_JSON&&!env.GOOGLE_APPLICATION_CREDENTIALS;
}

/** Local-only pilot with transactional quota. No contact terms stored. */
export function createStaffDirectoryEmulatorRouter(db:Firestore,auth:Auth){
 const router=express.Router();
 router.all('/staff-directory-pilot/:operation',async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  if(!staffDirectoryPilotEnabled(db)||auth.app.options.projectId!==PROJECT||
   !['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress||'')||
   !/^127\.0\.0\.1(:\d+)?$/.test(req.get('host')||'')){res.sendStatus(404);return;}
  const operation=req.params.operation;
  if(operation!=='search'&&operation!=='invite'){res.sendStatus(404);return;}
  if(req.method!=='POST'){res.set('Allow','POST').sendStatus(405);return;}
  const token=/^Bearer (\S+)$/i.exec(req.get('authorization')||'')?.[1];
  if(!token||token.length>8192){res.sendStatus(401);return;}
  let uid:string;
  try{
   const identity=await auth.verifyIdToken(token,true);
   if(identity.aud!==PROJECT||!isDocumentId(identity.uid)||identity.email_verified!==true)throw Error('AUTH_INVALID');
   const actor=await auth.getUser(identity.uid);
   if(actor.disabled||!actor.emailVerified)throw Error('AUTH_INVALID');
   uid=identity.uid;
  }catch{res.sendStatus(401);return;}
  try{
   const quota=await consumeDirectoryQuota(db,uid,'staff');
   if(quota.allowed===false){res.set('Retry-After',String(quota.retryAfterSeconds)).sendStatus(429);return;}
  }catch{res.status(503).json({error:'STAFF_DIRECTORY_UNAVAILABLE'});return;}
  const body=req.body;
  const allowed=operation==='search'?['storeId','term','role']:['storeId','term','role','targetUid'];
  if(Object.keys(req.query).length||!body||typeof body!=='object'||Array.isArray(body)||
    Object.keys(body).length!==allowed.length||Object.keys(body).some(key=>!allowed.includes(key))||
    allowed.some(key=>typeof body[key]!=='string')){
   res.status(400).json({error:'STAFF_DIRECTORY_INVALID'});return;
  }
  try{
   if(operation==='search'){res.json({entries:await searchStoreStaffDirectory(db,auth,uid,body.storeId,body.term,body.role)});return;}
   res.status(201).json(await createStoreStaffInvitation(db,auth,uid,body.storeId,body.targetUid,body.term,body.role));
  }catch(error){
   const code=error instanceof Error?error.message:'';
   if(code==='STAFF_DIRECTORY_INVALID'){res.status(400).json({error:code});return;}
   if(code==='STAFF_DIRECTORY_FORBIDDEN'||code==='STAFF_DIRECTORY_AGE_REQUIRED'){res.status(403).json({error:'STAFF_DIRECTORY_FORBIDDEN'});return;}
   if(code==='STAFF_INVITATION_EXISTS'){res.status(409).json({error:code});return;}
   res.status(503).json({error:'STAFF_DIRECTORY_UNAVAILABLE'});
  }
 });
 return router;
}
