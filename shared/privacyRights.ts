// Shared contract only. No authentication, legal deadline engine or data mutation.
export const PRIVACY_RIGHTS={
 'confirm-processing':'Confirmar tratamento dos meus dados',
 access:'Acessar meus dados',
 correction:'Corrigir dados',
 'anonymize-block-delete':'Solicitar anonimização, bloqueio ou eliminação',
 portability:'Solicitar portabilidade',
 sharing:'Conhecer compartilhamentos',
 'consent-information':'Informações sobre consentimento',
 'withdraw-consent':'Revogar consentimento',
 objection:'Apresentar oposição ao tratamento',
 'automated-review':'Solicitar revisão de decisão automatizada',
 other:'Outra solicitação de privacidade'
} as const;
export type PrivacyRight=keyof typeof PRIVACY_RIGHTS;
export const PRIVACY_CONTEXTS={ecosystem:'Conta e serviços Kyrub',cid:'Cartão de Informação Digital (CID)',thirdParty:'Dados tratados sem conta Kyrub'} as const;
export type PrivacyContext=keyof typeof PRIVACY_CONTEXTS;
export type PrivacyRequestDraft={right:PrivacyRight;context:PrivacyContext;confirmed:true};
export type PrivacyRequestReceipt={protocol:string;status:'received';simulated:boolean;trackingCode?:string;trackingExpiresAt?:number};
export type PrivacyRightsAdapter={submit:(draft:PrivacyRequestDraft)=>Promise<PrivacyRequestReceipt>};
export function normalizePrivacyRequest(input:unknown):PrivacyRequestDraft{
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('PRIVACY_REQUEST_INVALID');
 const v=input as Record<string,unknown>;
 if(Object.keys(v).length!==3||Object.keys(v).some(k=>!['right','context','confirmed'].includes(k))||typeof v.right!=='string'||!Object.hasOwn(PRIVACY_RIGHTS,v.right)||typeof v.context!=='string'||!Object.hasOwn(PRIVACY_CONTEXTS,v.context)||v.confirmed!==true)throw Error('PRIVACY_REQUEST_INVALID');
 return {right:v.right as PrivacyRight,context:v.context as PrivacyContext,confirmed:true};
}
