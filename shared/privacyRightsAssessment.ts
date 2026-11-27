export const PRIVACY_ASSESSMENT_RIGHTS=['confirm-processing','access','correction'] as const;
export type PrivacyAssessmentRight=typeof PRIVACY_ASSESSMENT_RIGHTS[number];
export const PRIVACY_ASSESSMENT_FINDINGS={
 'additional-verification':'Comprovação adicional necessária',
 'individual-review':'Encaminhar para atendimento individual',
 'ready-for-fulfillment-review':'Preparar atendimento do direito'
} as const;
export type PrivacyAssessmentFinding=keyof typeof PRIVACY_ASSESSMENT_FINDINGS;
export type PrivacyAssessmentInput={protocol:string;expectedRevision:number;finding:PrivacyAssessmentFinding;reason:string};
export type PrivacyAssessmentReceipt={protocol:string;revision:number;finding:PrivacyAssessmentFinding;simulation:true;actionStatus:'not-executed'};
