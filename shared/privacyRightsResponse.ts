import type {PrivacyAssessmentFinding} from './privacyRightsAssessment';
export const PRIVACY_RESPONSE_MESSAGES={
 'additional-verification':'Precisamos de comprovação adicional para analisar sua solicitação. Utilize o canal de privacidade para receber orientações seguras. O protocolo permanece aberto.',
 'individual-review':'Sua solicitação requer atendimento individual. O protocolo permanece aberto e não é necessário criar conta no Kyrub.',
 'ready-for-fulfillment-review':'Sua solicitação foi encaminhada para preparação do atendimento. Nenhuma entrega, correção ou eliminação de dados foi executada.'
} satisfies Record<PrivacyAssessmentFinding,string>;
export type PrivacyResponseStatus='draft'|'reviewed';
export type PrivacyResponseInput={protocol:string;expectedAssessmentRevision:number};
export type PrivacyResponseReviewInput={protocol:string;expectedAssessmentRevision:number;expectedResponseRevision:number;decision:'approve'|'return'};
export type PrivacyResponseReceipt={protocol:string;revision:number;status:PrivacyResponseStatus;simulation:true;delivered:false;actionStatus:'not-executed'};
