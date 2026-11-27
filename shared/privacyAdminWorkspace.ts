import type {PrivacyRequestDraft} from './privacyRights';
import type {PrivacyIdentityEvidenceState} from './privacyIdentityReview';
import {PRIVACY_ASSESSMENT_RIGHTS,type PrivacyAssessmentFinding,type PrivacyAssessmentInput,type PrivacyAssessmentReceipt} from './privacyRightsAssessment';
import type {PrivacyResponseInput,PrivacyResponseReviewInput,PrivacyResponseReceipt,PrivacyResponseStatus} from './privacyRightsResponse';
export type PrivacyAdminItem={protocol:string;draft:PrivacyRequestDraft;receivedAt:number;revision:number;triageStatus:'pending-review'|'verification-required';identityStatus:'pending-verification';actionStatus:'not-executed';evidenceStatus:PrivacyIdentityEvidenceState;assessmentRevision:number;assessmentFinding?:PrivacyAssessmentFinding;responseStatus?:PrivacyResponseStatus;responseRevision?:number};
export type PrivacyAdminAdapter={
 list:()=>Promise<{items:PrivacyAdminItem[];hasMore:boolean;simulation:true}>;
 triage:(input:{protocol:string;expectedRevision:0})=>Promise<{protocol:string;revision:1;triageStatus:'verification-required';identityStatus:'pending-verification';actionStatus:'not-executed';simulation:true}>;
 assess:(input:PrivacyAssessmentInput)=>Promise<PrivacyAssessmentReceipt>;
 prepareResponse:(input:PrivacyResponseInput)=>Promise<PrivacyResponseReceipt>;
 reviewResponse:(input:PrivacyResponseReviewInput)=>Promise<PrivacyResponseReceipt>;
};
export function privacyAdminActions(item:PrivacyAdminItem){
 const assessed=item.assessmentRevision>0&&!!item.assessmentFinding;
 const supported=PRIVACY_ASSESSMENT_RIGHTS.some(r=>r===item.draft.right);
 return {
 triage:item.revision===0&&item.triageStatus==='pending-review',
 assess:supported&&item.revision===1&&item.triageStatus==='verification-required'&&item.assessmentFinding!=='ready-for-fulfillment-review',
 prepare:assessed&&!item.responseStatus,
 review:assessed&&item.responseStatus==='draft'&&Number.isSafeInteger(item.responseRevision)&&Number(item.responseRevision)>0,
 };
}
