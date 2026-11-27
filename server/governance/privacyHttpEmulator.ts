// Explicit standalone test harness only. Never mount in a production or preview route.
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {TLSSocket} from 'node:tls';
import {assertPrivacyEmulator,createPrivacyRightsEmulator} from './privacyRightsEmulator.js';
import {createPrivacyRightsAdminEmulator} from './privacyRightsAdminEmulator.js';
import type {AuthenticationResponseJSON} from '@simplewebauthn/server';
import {createPrivacyCidEvidenceEmulator,PRIVACY_CID_ORIGIN} from './privacyCidEvidenceEmulator.js';
import {createPrivacyOptionalConsentEmulator} from './privacyOptionalConsentEmulator.js';
export const PRIVACY_HTTP_ORIGIN='https://127.0.0.1:8449';
const deny=():never=>{throw Error('PRIVACY_HTTP_DENIED');};
function guard(){assertPrivacyEmulator();if(process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')return deny();}
function object(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))return deny();return v as Record<string,unknown>;}
function exact(v:Record<string,unknown>,keys:string[]){if(Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))return deny();}
function opaque(v:unknown):string{if(typeof v!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(v))return deny();return v;}
function protocol(v:unknown):string{if(typeof v!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v))return deny();return v;}
function token(req:IncomingMessage){const t=/^Bearer ([^\s]+)$/.exec(req.headers.authorization??'')?.[1];if(!t||t.length>8192)return deny();return t;}
async function body(req:IncomingMessage){
 if(req.headers['content-type']!=='application/json')return deny();
 const chunks:Buffer[]=[];let n=0;
 for await(const chunk of req){const b=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);n+=b.length;if(n>16384)return deny();chunks.push(b);}
 return object(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}
function respond(res:ServerResponse,status:number,value:unknown){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(value));}
export function createPrivacyHttpEmulatorHandler(){
 guard();
 return async(req:IncomingMessage,res:ServerResponse)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Pragma','no-cache');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  try{
   guard();
   const requestOrigin=req.headers.origin;
   if(requestOrigin!==PRIVACY_HTTP_ORIGIN&&requestOrigin!==PRIVACY_CID_ORIGIN)return deny();
   if((req.socket as TLSSocket).encrypted!==true||req.socket.localAddress!=='127.0.0.1'||req.socket.remoteAddress!=='127.0.0.1'||req.socket.localPort!==8449||req.method!=='POST'||req.headers.host!==new URL(requestOrigin).host||req.headers['x-privacy-homologation']!=='1'||(req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin'))return respond(res,403,{error:'PRIVACY_HTTP_DENIED'});
   const match=/^\/privacy-homologation\/api\/(submit|track|revoke|confirm-account|cid-begin|cid-finish|admin-list|admin-triage|admin-assess|admin-prepare|admin-review|consents-list|consents-change)$/.exec(req.url??'');
   if(!match)return respond(res,404,{error:'PRIVACY_HTTP_DENIED'});
   const action=match[1],input=await body(req),now=Date.now();
   if(action.startsWith('admin-')){
    const admin=createPrivacyRightsAdminEmulator(),idToken=token(req);
    if(action==='admin-list'){exact(input,[]);return respond(res,200,await admin.list(idToken,now));}
    if(action==='admin-triage')return respond(res,200,await admin.markVerificationRequired(idToken,input,now));
    if(action==='admin-assess')return respond(res,200,await admin.assess(idToken,input,now));
    if(action==='admin-prepare')return respond(res,200,await admin.prepareResponse(idToken,input,now));
    if(action==='admin-review')return respond(res,200,await admin.reviewResponse(idToken,input,now));
    return deny();
   }
   if(action.startsWith('consents-')){
    const consents=createPrivacyOptionalConsentEmulator(),idToken=token(req);
    if(action==='consents-list'){exact(input,[]);return respond(res,200,await consents.list(idToken,now));}
    return respond(res,200,await consents.change(idToken,input,now));
   }
   const intake=createPrivacyRightsEmulator();
   if(action==='submit'){
    exact(input,['credential','requestId','draft']);const c=object(input.credential);exact(c,['id','secret']);
    return respond(res,200,await intake.submit({id:opaque(c.id),secret:opaque(c.secret)},opaque(input.requestId),input.draft,now));
   }
   if(action==='cid-begin'||action==='cid-finish'){
    if(requestOrigin!==PRIVACY_CID_ORIGIN)return deny();
    const cid=createPrivacyCidEvidenceEmulator();
    if(action==='cid-begin'){exact(input,['protocol','code']);return respond(res,200,await cid.begin(protocol(input.protocol),opaque(input.code),requestOrigin,now));}
    exact(input,['protocol','code','challengeId','response']);return respond(res,200,await cid.finish(protocol(input.protocol),opaque(input.code),requestOrigin,opaque(input.challengeId),object(input.response) as unknown as AuthenticationResponseJSON,now));
   }
   exact(input,['protocol','code']);const p=protocol(input.protocol),code=opaque(input.code);
   if(action==='track')return respond(res,200,await intake.track(p,code,now));
   if(action==='revoke')return respond(res,200,await intake.revokeTracking(p,code,now));
   return respond(res,200,await intake.confirmExistingAccount(p,code,token(req),now));
  }catch{return respond(res,403,{error:'PRIVACY_HTTP_DENIED'});}
 };
}
