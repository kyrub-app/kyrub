import type {CidSpecialistFinding,CidSpecialistAdapter} from './cidEvidenceSpecialist';
export const CID_REVIEW_DISPOSITIONS={dismissed:'Arquivar solicitação',escalated:'Encaminhar para análise especializada'} as const;
export type CidReviewDisposition=keyof typeof CID_REVIEW_DISPOSITIONS;
export type CidReviewQueueItem={id:string;kind:'complaint'|'preservation';occurrenceId:string;tagId:string;createdAt:number;status:'pending-review'|CidReviewDisposition;revision:number;specialistFinding?:CidSpecialistFinding};
export type CidReviewDetail={item:CidReviewQueueItem;reason:string;category?:string;reporterRole?:'owner'|'emitter'|'contact'};
export type CidReviewInput={id:string;expectedRevision:number;disposition:CidReviewDisposition;reason:string};
export type CidEvidenceReviewAdapter={specialist?:CidSpecialistAdapter;list:()=>Promise<{items:CidReviewQueueItem[];hasMore:boolean}>;detail:(id:string)=>Promise<CidReviewDetail>;decide:(input:CidReviewInput)=>Promise<{revision:number;status:CidReviewDisposition}>};
