import type {KyrubMcpHttpRequest,KyrubMcpHttpResponse} from '../mcp/kyrubiaMcpServer.js';
import {adminAuth,getFirebaseAdminProjectId} from '../firebaseAdmin.js';

const PROJECT='kyrub-tags',BRANCH='feat/kyrub-social-tag-integration';
const previewHost=(value:unknown):value is string=>typeof value==='string'&&/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.vercel\.app$/.test(value);
type Env=Record<string,string|undefined>;
type Identity={uid:string;email_verified?:boolean};
type Deps={env:()=>Env;project:()=>string;verify:(token:string)=>Promise<Identity>};

/** Separate read-only Preview preflight. Never grants a reserved session,
 * activates a pilot, reads a directory or modifies Firebase. */
export function socialPreviewPreflightAllowed(env:Env,host:unknown):boolean{
 return env.KYRUB_SOCIAL_PREVIEW_PREFLIGHT==='true'&&env.VERCEL==='1'&&env.VERCEL_ENV==='preview'&&
  env.VERCEL_GIT_COMMIT_REF===BRANCH&&env.FIREBASE_PROJECT_ID===PROJECT&&
  env.VITE_FIREBASE_PROJECT_ID===PROJECT&&env.KYRUB_TAG_PROMO_PILOT_PROJECT_ID===PROJECT&&
  env.VITE_KYRUB_TAG_PILOT_CLIENT_FIREBASE==='true'&&
  env.VITE_FIREBASE_AUTH_DOMAIN===PROJECT+'.firebaseapp.com'&&
  env.VITE_FIREBASE_STORAGE_BUCKET===PROJECT+'.firebasestorage.app'&&
  previewHost(env.VERCEL_URL)&&previewHost(env.KYRUB_SOCIAL_PREVIEW_HOST)&&
  host===env.KYRUB_SOCIAL_PREVIEW_HOST&&
  !!env.FIREBASE_SERVICE_ACCOUNT_JSON&&!env.GOOGLE_APPLICATION_CREDENTIALS&&
  !env.FIRESTORE_EMULATOR_HOST&&!env.FIREBASE_AUTH_EMULATOR_HOST&&
  !env.FIREBASE_STORAGE_EMULATOR_HOST&&
  env.KYRUB_RESERVED_TRIBE_PILOT!=='true'&&
  env.VITE_KYRUB_SOCIAL_MEMORY_CACHE_E2E!=='true'&&
  env.VITE_KYRUB_FIREBASE_EMULATOR_E2E!=='true';
}
export function createSocialPreviewPreflight(deps:Deps){
 return async (request:KyrubMcpHttpRequest,response:KyrubMcpHttpResponse)=>{
  response.setHeader('Cache-Control','no-store, private, max-age=0');
  response.setHeader('Vary','Authorization, Host');
  const missing=()=>{response.status(404).json({error:'NOT_FOUND'});};
  const env=deps.env();
  if(!socialPreviewPreflightAllowed(env,request.headers.host)){missing();return;}
  if(request.method!=='GET'){response.setHeader('Allow','GET');response.status(405).json({error:'METHOD_NOT_ALLOWED'});return;}
  try{if(deps.project()!==PROJECT){missing();return;}}catch{missing();return;}
  const header=request.headers.authorization??request.headers.Authorization;
  const token=typeof header==='string'?/^Bearer ([^\s]+)$/i.exec(header)?.[1]:undefined;
  if(!token||token.length>8192){response.status(401).json({error:'AUTH_REQUIRED'});return;}
  try{
   const identity=await deps.verify(token);
   if(!/^[A-Za-z0-9_-]{1,128}$/.test(identity.uid)||identity.email_verified!==true)throw Error('AUTH_REQUIRED');
  }catch{response.status(401).json({error:'AUTH_REQUIRED'});return;}
  // Report only the checks performed. Runtime client cache and deployed rules
  // require independent evidence. No UID, email or credential is returned.
  response.status(200).json({configuration:'isolated-preview',project:PROJECT,branch:BRANCH,identityVerified:true,
   reservedPilotEnabled:false,firestoreRulesVerified:false,clientCacheVerified:false,releaseApproved:false});
 };
}
export const handleSocialPreviewPreflight=createSocialPreviewPreflight({
 env:()=>process.env,project:getFirebaseAdminProjectId,verify:token=>adminAuth.verifyIdToken(token,true)
});
