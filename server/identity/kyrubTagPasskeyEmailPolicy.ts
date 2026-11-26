import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {normalizeTagRecipientEmail} from '../../shared/kyrubTagContract.js';
export const EMAIL_RECOVERY_TTL=15*60*1000;
export type EmailProofKind='bind'|'recover';
export type PendingEmailProof={kind:EmailProofKind;emailDigest:string;codeDigest:string;credentialId:string;expiresAt:number};
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const hex=(s:unknown):s is string=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
export function normalizeRecoveryEmail(input:unknown):string{
 const email=normalizeTagRecipientEmail(input);
 if(!email)throw Error('TAG_INVALID');
 return email;
}
export function recoveryEmailDigest(tagId:string,email:string){return hash('kyrub-tag-recovery-email-v1:'+tagId+':'+normalizeRecoveryEmail(email));}
export function newEmailProof(tagId:string,kind:EmailProofKind,emailDigest:string,credentialId:string,now=Date.now()){
 const code=randomBytes(32).toString('base64url');
 const pending:PendingEmailProof={kind,emailDigest,credentialId,expiresAt:now+EMAIL_RECOVERY_TTL,codeDigest:hash('kyrub-tag-email-proof-v1:'+tagId+':'+kind+':'+code)};
 return {code,pending};
}
export function sameEmailDigest(a:unknown,b:unknown):boolean{
 return hex(a)&&hex(b)&&timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
}
export function matchesEmailProof(tagId:string,kind:EmailProofKind,record:unknown,credentialId:string,code:unknown,now=Date.now()):record is PendingEmailProof{
 if(!record||typeof record!=='object'||typeof code!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(code))return false;
 const r=record as PendingEmailProof;
 return r.kind===kind&&r.credentialId===credentialId&&hex(r.emailDigest)&&Number.isSafeInteger(r.expiresAt)&&r.expiresAt>now&&r.expiresAt<=now+EMAIL_RECOVERY_TTL&&sameEmailDigest(r.codeDigest,hash('kyrub-tag-email-proof-v1:'+tagId+':'+kind+':'+code));
}
export function emailRecoveryConfigured(env:NodeJS.ProcessEnv=process.env):boolean{
 if(env.KYRUB_TAG_PASSKEY_EMAIL_RECOVERY_ENABLED!=='true'||!env.KYRUB_TAG_RECOVERY_EMAIL_DELIVERY_TOKEN)return false;
 try{const u=new URL(env.KYRUB_TAG_RECOVERY_EMAIL_DELIVERY_URL??'');return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash&&!u.search;}catch{return false;}
}
export type EmailDelivery=(email:string,kind:EmailProofKind,code:string)=>Promise<void>;
/** Provider-neutral trusted server-to-server delivery. No client-supplied endpoint, no Firebase account. */
export const deliverRecoveryEmail:EmailDelivery=async(email,kind,code)=>{
 if(!emailRecoveryConfigured())throw Error('TAG_EMAIL_UNAVAILABLE');
 const response=await fetch(process.env.KYRUB_TAG_RECOVERY_EMAIL_DELIVERY_URL!,{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+process.env.KYRUB_TAG_RECOVERY_EMAIL_DELIVERY_TOKEN,'Content-Type':'application/json'},
  body:JSON.stringify({to:email,subject:kind==='bind'?'Confirme seu e-mail de recuperação Kyrub Tag':'Recuperação da Kyrub Tag',text:'Seu código temporário Kyrub Tag: '+code+'\nValidade: 15 minutos. Não compartilhe. Se você não solicitou, ignore esta mensagem.'})
 });
 if(!response.ok)throw Error('TAG_EMAIL_UNAVAILABLE');
};
export function requireEmailRecovery(){if(!emailRecoveryConfigured())throw Error('TAG_EMAIL_UNAVAILABLE');}
export function nextEmailSendQuota(data:Record<string,unknown>|undefined,now=Date.now()){
 const bucket=Math.floor(now/3600000),count=data?.bucket===bucket?Number(data.count):0;
 if(!Number.isSafeInteger(count)||count<0||count>=3)throw Error('TAG_PASSKEY_RATE_LIMIT');
 return {bucket,count:count+1};
}
