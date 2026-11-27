import {normalizeCidPix} from './cidPix.js';
import {normalizePersonalPixKey,type PersonalPixKeyType} from './personalPixDestination.js';
/**
 * Syntax-only bridge. Caller must obtain the CID through authoritative
 * authenticated ownership/linkage and separately authorize financial use.
 * Never use this function alone as authorization to persist a destination.
 */
export function normalizeCidPersonalPixCandidate(input:unknown){
 const cid=normalizeCidPix(input);
 if(cid.keyType==='cnpj')throw Error('CID_PERSONAL_PIX_UNSUPPORTED');
 return normalizePersonalPixKey({keyType:cid.keyType,key:cid.key});
}
export function projectCidPersonalPixCandidate(input:unknown):{keyType:PersonalPixKeyType;maskedKey:string;ownershipVerified:false}{
 const candidate=normalizeCidPersonalPixCandidate(input);
 return {keyType:candidate.keyType,maskedKey:'••••'+candidate.key.slice(-4),ownershipVerified:false};
}
