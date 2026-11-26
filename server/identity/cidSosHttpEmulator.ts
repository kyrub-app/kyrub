// Standalone homologation handler. Never mount in server.ts or any production/preview route.
// The caller must bind exclusively to a local TLS test server with this exact host.
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {TLSSocket} from 'node:tls';
import type {AuthenticationResponseJSON} from '@simplewebauthn/server';
import {assertCidSosEmulator,createCidSosEmulatorStore} from './cidSosEmulatorStore.js';
import {createCidChatEmulatorStore,CID_CHAT_EMULATOR_ORIGIN} from './cidChatEmulatorStore.js';
import {normalizeCidSosRequest} from '../../shared/cidSosRequest.js';
import {CID_CHAT_SESSION_TTL_MS} from './cidOccurrenceChatAccess.js';

const prefix='/cid-homologation/api';
const origin=CID_CHAT_EMULATOR_ORIGIN,host=new URL(origin).host;
const cookieName='__Secure-cid-homologation';
const opaque=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v);
type Credential={id:string;secret:string};
type ContactEnvelope=Awaited<ReturnType<ReturnType<typeof createCidChatEmulatorStore>['prepareContactConfirmationForDelivery']>>['deliveryEnvelope'];
const deny=():never=>{throw Error('CID_HTTP_DENIED');};
function object(v:unknown):Record<string,unknown>{
 if(!v||typeof v!=='object'||Array.isArray(v))return deny();return v as Record<string,unknown>;
}
function exact(v:Record<string,unknown>,keys:string[]){
 if(Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))return deny();
}
function credential(v:unknown):Credential{
 const x=object(v);exact(x,['id','secret']);
 if(!opaque(x.id)||!opaque(x.secret))return deny();return {id:x.id,secret:x.secret};
}
function cookie(req:IncomingMessage):Credential{
 const matches=(req.headers.cookie??'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(cookieName+'='));
 if(matches.length!==1)return deny();
 const [id,secret,...rest]=matches[0].slice(cookieName.length+1).split('.');
 if(rest.length||!opaque(id)||!opaque(secret))return deny();return {id,secret};
}
function setCookie(res:ServerResponse,path:string,session?:Credential){
 const value=session?session.id+'.'+session.secret:'';
 const maxAge=session?Math.floor(CID_CHAT_SESSION_TTL_MS/1000):0;
 res.setHeader('Set-Cookie',cookieName+'='+value+'; Path='+path+'; Max-Age='+maxAge+'; HttpOnly; Secure; SameSite=Strict');
}
async function body(req:IncomingMessage){
 if(req.headers['content-type']!=='application/json')return deny();
 const chunks:Buffer[]=[];let total=0;
 for await(const chunk of req){
  const b=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);total+=b.length;
  if(total>16384)return deny();chunks.push(b);
 }
 return object(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}
function respond(res:ServerResponse,status:number,value:unknown){
 res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');
 res.end(JSON.stringify(value));
}
export function createCidSosHttpEmulatorHandler(deliverSimulatedConfirmation:(envelope:ContactEnvelope)=>Promise<void>){
 assertCidSosEmulator();
 return async(req:IncomingMessage,res:ServerResponse)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Pragma','no-cache');
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  try{
   assertCidSosEmulator();
   // No CORS, no forwarded-origin trust, no GET state changes or credential-bearing query.
   if((req.socket as TLSSocket).encrypted!==true||req.socket.localAddress!=='127.0.0.1'||req.socket.remoteAddress!=='127.0.0.1'||req.method!=='POST'||req.headers.host!==host||req.headers.origin!==origin||req.headers['x-cid-homologation']!=='1'||(req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin'))return respond(res,403,{error:'CID_HTTP_DENIED'});
   const match=/^\/cid-homologation\/api\/([a-f0-9]{32})\/([A-Za-z0-9_-]{22,80})\/(emit|owner-begin|owner-finish|contact-request|contact-confirm|read|send|close|revoke)$/.exec(req.url??'');
   if(!match)return respond(res,404,{error:'CID_HTTP_DENIED'});
   const [,tagId,occurrenceId,action]=match,path=prefix+'/'+tagId+'/'+occurrenceId+'/';
   const input=await body(req),now=Date.now();
   const chat=createCidChatEmulatorStore(tagId,occurrenceId);
   if(action==='emit'){
    exact(input,['request','seed']);const request=normalizeCidSosRequest(input.request);
    if(request.id!==occurrenceId)return deny();
    const result=await createCidSosEmulatorStore(tagId).submitEmitterAlert(request,input.seed,now);
    setCookie(res,path,result.session);return respond(res,200,{accepted:true,simulated:true});
   }
   if(action==='owner-begin'){exact(input,[]);return respond(res,200,await chat.beginOwnerPasskey(origin,now));}
   if(action==='owner-finish'){
    exact(input,['challengeId','response']);if(!opaque(input.challengeId))return deny();
    const result=await chat.finishOwnerPasskey(origin,input.challengeId,object(input.response) as unknown as AuthenticationResponseJSON,now);
    setCookie(res,path,result);return respond(res,200,{accepted:true,simulated:true});
   }
   if(action==='contact-request'){
    exact(input,['invitation']);
    const result=await chat.prepareContactConfirmationForDelivery(credential(input.invitation),now);
    await deliverSimulatedConfirmation(result.deliveryEnvelope);
    return respond(res,200,{...result.publicResult,simulated:true});
   }
   if(action==='contact-confirm'){
    exact(input,['invitation','challengeId','confirmation']);if(!opaque(input.challengeId))return deny();
    const result=await chat.confirmContact(credential(input.invitation),input.challengeId,input.confirmation,now);
    setCookie(res,path,result);return respond(res,200,{accepted:true,simulated:true});
   }
   const session=cookie(req);
   if(action==='read'){exact(input,[]);return respond(res,200,await chat.read(session,now));}
   if(action==='send'){exact(input,['id','body']);return respond(res,200,await chat.send(session,input,now));}
   if(action==='close'){exact(input,[]);return respond(res,200,await chat.close(session,now));}
   if(action==='revoke'){exact(input,[]);await chat.revokeOwnSession(session,now);setCookie(res,path);return respond(res,200,{revoked:true});}
   return deny();
  }catch{
   // Deliberately do not log request bodies, cookies, contact destinations, or secrets.
   if(!res.headersSent)respond(res,403,{error:'CID_HTTP_DENIED'});
   else res.end();
  }
 };
}
