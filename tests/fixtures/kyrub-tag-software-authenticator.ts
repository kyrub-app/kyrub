// Test-only software authenticator. Real ES256 keys and signatures, synthetic
// authenticator data. No production dependency, biometric claim or device test.
import {createHash,generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import type {RegistrationResponseJSON,AuthenticationResponseJSON} from '@simplewebauthn/server';

type Cbor=number|string|Buffer|Map<Cbor,Cbor>;
function head(major:number,n:number):Buffer{
 if(n<24)return Buffer.from([(major<<5)|n]);
 if(n<256)return Buffer.from([(major<<5)|24,n]);
 if(n<65536){const result=Buffer.alloc(3);result[0]=(major<<5)|25;result.writeUInt16BE(n,1);return result;}
 throw Error('fixture CBOR length');
}
function cbor(v:Cbor):Buffer{
 if(typeof v==='number')return v>=0?head(0,v):head(1,-1-v);
 if(typeof v==='string'){const bytes=Buffer.from(v);return Buffer.concat([head(3,bytes.length),bytes]);}
 if(Buffer.isBuffer(v))return Buffer.concat([head(2,v.length),v]);
 return Buffer.concat([head(5,v.size),...Array.from(v,([k,value])=>Buffer.concat([cbor(k),cbor(value)]))]);
}
const sha=(v:Buffer|string)=>createHash('sha256').update(v).digest();
const b64=(v:Buffer)=>v.toString('base64url');
type ChallengeOptions={challenge:string};
export function makeSoftwareTagAuthenticator(origin:string,rpId:string){
 const {publicKey,privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
 const jwk=publicKey.export({format:'jwk'});
 const rawId=randomBytes(32),id=b64(rawId);
 const cose=cbor(new Map<Cbor,Cbor>([[1,2],[3,-7],[-1,1],[-2,Buffer.from(jwk.x!,'base64url')],[-3,Buffer.from(jwk.y!,'base64url')]]));
 let userHandle='',counter=0;
 function clientData(type:string,challenge:string,actualOrigin=origin){
  return Buffer.from(JSON.stringify({type,challenge,origin:actualOrigin,crossOrigin:false}));
 }
 function base(flags:number,count:number){
  const countBytes=Buffer.alloc(4);countBytes.writeUInt32BE(count);
  return Buffer.concat([sha(rpId),Buffer.from([flags]),countBytes]);
 }
 return {id,
  register(options:ChallengeOptions&{user:{id:string}}):RegistrationResponseJSON{
   userHandle=options.user.id;
   const len=Buffer.alloc(2);len.writeUInt16BE(rawId.length);
   const authData=Buffer.concat([base(0x45,0),Buffer.alloc(16),len,rawId,cose]);
   const attestationObject=cbor(new Map<Cbor,Cbor>([['fmt','none'],['attStmt',new Map<Cbor,Cbor>()],['authData',authData]]));
   return {id,rawId:id,type:'public-key',clientExtensionResults:{},response:{clientDataJSON:b64(clientData('webauthn.create',options.challenge)),attestationObject:b64(attestationObject),transports:['internal']}};
  },
  assert(options:ChallengeOptions,config:{uv?:boolean;credentialId?:string;handle?:string;origin?:string}={}):AuthenticationResponseJSON{
   const data=clientData('webauthn.get',options.challenge,config.origin),authData=base(config.uv===false?0x01:0x05,++counter);
   const sig=sign('sha256',Buffer.concat([authData,sha(data)]),privateKey);
   const claimed=config.credentialId??id;
   return {id:claimed,rawId:claimed,type:'public-key',clientExtensionResults:{},response:{clientDataJSON:b64(data),authenticatorData:b64(authData),signature:b64(sig),userHandle:config.handle??userHandle}};
  },
  get handle(){return userHandle;}
 };
}
