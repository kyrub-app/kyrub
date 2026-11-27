import type {CidLegalReviewInput} from './cidEvidenceLegalReview';
export type CidAuthorizationScope=NonNullable<CidLegalReviewInput['scope']>;
export type CidAuthorizationInput={id:string;expectedRevision:number;operatorId:string;reason:string};
export type CidAuthorizationRevokeInput={id:string;expectedRevision:number;reason:string};
export type CidAuthorizationReceipt={id:string;revision:number;status:'simulation-authorized'|'simulation-revoked';expiresAt:number;simulation:true;executionEnabled:false};
