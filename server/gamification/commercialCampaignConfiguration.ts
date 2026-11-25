import { createHash } from 'node:crypto';
import { FIRST_LOGIN_WELCOME_PITANGAS } from './firstLoginWelcome.js';
import { SEEDS_PER_PITANGUEIRA, SEEDS_PER_BOSQUE } from '../../shared/pitangueiraJourney.js';
import { SEMEADURA_DAILY_LIMIT, SEMEADURA_DAY_TIMEZONE } from '../../shared/semeaduraDailyLimit.js';
import { PITANGAS_PER_XP } from '../../shared/pitangaXpConversion.js';

/** Offline commercial configuration contract. NOT a runtime release gate,
 * approval signature, writer attestation, or permission to write Firestore.
 * No environment flags, SDK, deployment or administrative route here. */
const policy=Object.freeze({
 welcomePitangas:FIRST_LOGIN_WELCOME_PITANGAS,
 welcomeProvider:'google.com',
 welcomeRetroactive:false,
 firstStorePublicationXp:2,
 dailySeedLimit:SEMEADURA_DAILY_LIMIT,
 dailyTimezone:SEMEADURA_DAY_TIMEZONE,
 seedsPerPitanga:SEEDS_PER_PITANGUEIRA,
 postSeedCap:SEEDS_PER_BOSQUE,
 pitangasPerXp:PITANGAS_PER_XP,
 voluntaryConversion:true,
 irreversibleSeed:true,
 communityRewards:false,
 journeyStartsAtZero:true,
});
export const COMMERCIAL_GAMIFICATION_POLICY=policy;

export type CommercialCampaignConfiguration={
 schemaVersion:1;projectId:'kyrub-b8d0e';databaseId:'(default)';
 campaignId:string;fenceEpoch:string;welcomeEffectiveAt:string;semeaduraEffectiveAt:string;
 candidateCommit:string;writerEvidenceSha256:string;rulesSha256:string;
 policy:typeof policy;
};
const keys=['schemaVersion','projectId','databaseId','campaignId','fenceEpoch','welcomeEffectiveAt','semeaduraEffectiveAt','candidateCommit','writerEvidenceSha256','rulesSha256','policy'];
const exact=(o:Record<string,unknown>,expected:string[])=>Object.keys(o).length===expected.length&&expected.every(k=>Object.hasOwn(o,k));
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const safeId=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(v)&&!/(demo|emulator|fixture|pilot|test)/i.test(v);
const sha=(v:unknown,n:number)=>typeof v==='string'&&v.length===n&&/^[a-f0-9]+$/.test(v)&&!/^0+$/.test(v);
const instant=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;

/** Reject unknown keys and changes to approved economic rules; do not supply
 * default dates or attestations. Return canonical serialized contents, not
 * the input object, so property order cannot alter the fingerprint. */
export function commercialCampaignFingerprint(value:unknown):string{
 if(!object(value)||!exact(value,keys)||value.schemaVersion!==1||value.projectId!=='kyrub-b8d0e'||
    value.databaseId!=='(default)'||!safeId(value.campaignId)||!safeId(value.fenceEpoch)||
    !instant(value.welcomeEffectiveAt)||!instant(value.semeaduraEffectiveAt)||
    !sha(value.candidateCommit,40)||!sha(value.writerEvidenceSha256,64)||!sha(value.rulesSha256,64)||
    !object(value.policy)||!exact(value.policy,Object.keys(policy))||
    Object.entries(policy).some(([k,v])=>value.policy && (value.policy as Record<string,unknown>)[k]!==v))
  throw Error('COMMERCIAL_CAMPAIGN_CONFIGURATION_INVALID');
 const canonical=Object.fromEntries(keys.map(k=>[k,k==='policy'?policy:value[k]]));
 return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/** Compare to a separately retained fingerprint. Never trust a fingerprint
 * supplied by the same untrusted record as proof of owner approval. */
export function assertCommercialCampaignUnchanged(value:unknown,approvedFingerprint:string):void{
 if(!sha(approvedFingerprint,64)||commercialCampaignFingerprint(value)!==approvedFingerprint)
  throw Error('COMMERCIAL_CAMPAIGN_CONFIGURATION_CHANGED');
}
