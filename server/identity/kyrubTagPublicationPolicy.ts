import {evaluateStoredCapabilityAgeAccess} from '../../shared/ageEligibility.js';
import { createHash } from 'node:crypto';
import { TAG_PUBLICATION_TERMS_VERSION, TAG_PUBLICATION_TERMS_TEXT, TAG_PUBLICATION_ACKNOWLEDGEMENT } from '../../shared/kyrubTagPublicationTerms.js';
import { normalizePromotionalPresentation } from '../../shared/kyrubTagPromotional.js';
const hash = (text:string) => createHash('sha256').update(text,'utf8').digest('hex');
export const tagTermsHash = hash(TAG_PUBLICATION_TERMS_TEXT+'\n'+TAG_PUBLICATION_ACKNOWLEDGEMENT);
const presentationHash = (value:unknown) => hash(JSON.stringify(normalizePromotionalPresentation(value)));
export function tagPublicationAllowed(actor:string, age:Record<string,unknown>|undefined, enabled:boolean):boolean {
 return enabled === true && evaluateStoredCapabilityAgeAccess({actorUid:actor,record:age,capability:'tag_publication',policy:'verified_adult_only'});
}
export function createTagPublicationReceipt(actor:string,id:string,presentation:unknown,acceptance:unknown,age:Record<string,unknown>|undefined,enabled:boolean,now:string){
 if(!tagPublicationAllowed(actor,age,enabled))throw Error('TAG_PUBLICATION_AGE_REQUIRED');
 if(!acceptance||typeof acceptance!=='object'||Array.isArray(acceptance))throw Error('TAG_PUBLICATION_TERMS_REQUIRED');
 const value=acceptance as Record<string,unknown>;
 if(Object.keys(value).length!==2||value.accepted!==true||value.version!==TAG_PUBLICATION_TERMS_VERSION)throw Error('TAG_PUBLICATION_TERMS_REQUIRED');
 return {actor,id,version:TAG_PUBLICATION_TERMS_VERSION,termsHash:tagTermsHash,presentationHash:presentationHash(presentation),acceptedAt:now};
}
export function canReadPublishedPromotionalTag(id:string,data:Record<string,unknown>,age:Record<string,unknown>|undefined,enabled:boolean):boolean {
 if(data.distribution!=='promotional'||data.enabled!==true||data.blocked===true||typeof data.ownerId!=='string'||!tagPublicationAllowed(data.ownerId,age,enabled))return false;
 const r=data.publicationReceipt as Record<string,unknown>|undefined;
 if(!r||r.actor!==data.ownerId||r.id!==id||r.version!==TAG_PUBLICATION_TERMS_VERSION||r.termsHash!==tagTermsHash||typeof r.acceptedAt!=='string'||!Number.isFinite(Date.parse(r.acceptedAt)))return false;
 try{return r.presentationHash===presentationHash(data.presentation);}catch{return false;}
}
