import {createHash,randomBytes,scrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const derive=promisify(scrypt);
export const MAX_TRIBE_ATTEMPTS=5;
export const TRIBE_LOCK_MS=15*60*1000;
export const TRIBE_SESSION_MS=5*60*1000;
export type TribeVerifier={salt:string;digest:string};
export type TribeAttemptState={failures:number;lockedUntil:number};
export function validTribeCode(code:unknown):code is string{
 return typeof code==='string'&&code.length>=8&&code.length<=64&&code===code.trim()&&!/[\u0000-\u001f\u007f]/.test(code);
}
export async function createTribeVerifier(code:unknown):Promise<TribeVerifier>{
 if(!validTribeCode(code))throw Error('TRIBE_CODE_INVALID');
 const salt=randomBytes(32).toString('hex');
 const digest=(await derive(code,salt,64) as Buffer).toString('hex');
 return {salt,digest};
}
export async function verifyTribeCode(code:unknown,verifier:TribeVerifier):Promise<boolean>{
 if(!validTribeCode(code)||!(/^[0-9a-f]{64}$/.test(verifier.salt))||!(/^[0-9a-f]{128}$/.test(verifier.digest)))return false;
 const derived=await derive(code,verifier.salt,64) as Buffer;
 return timingSafeEqual(derived,Buffer.from(verifier.digest,'hex'));
}
export function tribeAttemptLocked(state:TribeAttemptState,now:number):boolean{return state.lockedUntil>now;}
export function failedTribeAttempt(state:TribeAttemptState,now:number):TribeAttemptState{
 if(tribeAttemptLocked(state,now))return state;
 const failures=(state.lockedUntil>0?0:Math.max(0,state.failures))+1;
 return {failures,lockedUntil:failures>=MAX_TRIBE_ATTEMPTS?now+TRIBE_LOCK_MS:0};
}
export function issueTribeSession(now:number){
 const token=randomBytes(32).toString('hex');
 return {token,digest:tribeSessionDigest(token)!,expiresAt:now+TRIBE_SESSION_MS};
}
export function tribeSessionDigest(token:unknown):string|null{
 return typeof token==='string'&&/^[0-9a-f]{64}$/.test(token)?createHash('sha256').update(token).digest('hex'):null;
}
export function validTribeSession(token:unknown,digest:unknown,expiresAt:unknown,now:number):boolean{
 const candidate=tribeSessionDigest(token);
 return !!candidate&&typeof digest==='string'&&/^[0-9a-f]{64}$/.test(digest)&&typeof expiresAt==='number'&&expiresAt>now&&timingSafeEqual(Buffer.from(candidate,'hex'),Buffer.from(digest,'hex'));
}
