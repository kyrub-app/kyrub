// Synthetic catalogue. No advertising, analytics or communication provider enabled.
export const OPTIONAL_CONSENT_PURPOSES={
 'fixture-product-news':{label:'Novidades do produto (simulação)',description:'Receber novidades opcionais do Kyrub em um canal previamente autorizado.',version:'fixture-1'},
 'fixture-personalization':{label:'Personalização opcional (simulação)',description:'Personalizar sugestões de conteúdo com preferências fornecidas voluntariamente.',version:'fixture-1'}
} as const;
export type OptionalConsentPurpose=keyof typeof OPTIONAL_CONSENT_PURPOSES;
export type OptionalConsentRecord={purpose:OptionalConsentPurpose;version:string;noticeHash:string;revision:number;state:'granted'|'withdrawn';changedAt:number;simulation:true};
export type OptionalConsentChoice={purpose:OptionalConsentPurpose;expectedRevision:number;decision:'grant'|'withdraw';version:string;confirmed:true};
export type OptionalConsentView={purpose:OptionalConsentPurpose;label:string;description:string;version:string;revision:number;state:'not-granted'|'granted'|'withdrawn';effective:boolean;canWithdraw:boolean;simulation:true};
export type OptionalConsentAdapter={list:()=>Promise<OptionalConsentView[]>;change:(choice:OptionalConsentChoice)=>Promise<OptionalConsentView>};
export function normalizeOptionalConsentChoice(input:unknown):OptionalConsentChoice{
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('OPTIONAL_CONSENT_INVALID');
 const v=input as Record<string,unknown>;
 if(Object.keys(v).length!==5||Object.keys(v).some(k=>!['purpose','expectedRevision','decision','version','confirmed'].includes(k))||typeof v.purpose!=='string'||!Object.hasOwn(OPTIONAL_CONSENT_PURPOSES,v.purpose)||typeof v.expectedRevision!=='number'||!Number.isSafeInteger(v.expectedRevision)||v.expectedRevision<0||!['grant','withdraw'].includes(v.decision as string)||typeof v.version!=='string'||!v.version||v.version.length>64||v.confirmed!==true)throw Error('OPTIONAL_CONSENT_INVALID');
 return {purpose:v.purpose as OptionalConsentPurpose,expectedRevision:v.expectedRevision,decision:v.decision as OptionalConsentChoice['decision'],version:v.version,confirmed:true};
}
