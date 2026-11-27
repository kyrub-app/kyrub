export const CID_LEGAL_FIELDS={
 sourceIp:'IP de origem',connectionTime:'Horário da conexão',sourcePort:'Porta de origem',declaredClient:'Cliente declarado',internalSessionReference:'Referência interna de sessão'
} as const;
export type CidLegalField=keyof typeof CID_LEGAL_FIELDS;
export const CID_LEGAL_PURPOSES={preservation:'Preservação delimitada','authority-disclosure':'Eventual fornecimento à autoridade'} as const;
export type CidLegalPurpose=keyof typeof CID_LEGAL_PURPOSES;
export const CID_LEGAL_FINDINGS={'insufficient-documentation':'Documentação insuficiente','not-supported':'Sem fundamento para prosseguir','eligible-for-authorization-review':'Encaminhar para revisão de autorização'} as const;
export type CidLegalFinding=keyof typeof CID_LEGAL_FINDINGS;
export type CidLegalReviewInput={id:string;expectedRevision:number;finding:CidLegalFinding;reason:string;scope:null|{purpose:CidLegalPurpose;formalReference:string;authority:string;legalBasis:string;fields:CidLegalField[];from:number;to:number;expiresAt:number}};
export type CidLegalReviewReceipt={id:string;revision:number;finding:CidLegalFinding;simulation:true;authorizesRetention:false;authorizesDisclosure:false};
export type CidLegalReviewAdapter={review:(input:CidLegalReviewInput)=>Promise<CidLegalReviewReceipt>};
