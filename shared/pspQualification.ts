export type KyrubPsp = 'mercado_pago' | 'pagbank' | 'pagarme' | 'other';
export type KyrubSplitModel = 'one_to_one' | 'one_to_many';
export type KyrubCommercialGateStatus = 'not_required' | 'required' | 'approved' | 'rejected';

export interface KyrubPspQualificationDecision {
  provider: KyrubPsp;
  splitModel: KyrubSplitModel;
  technicallySupported: boolean;
  commercialGate: KyrubCommercialGateStatus;
  evidenceReference?: string;
  assessedAt: string;
}

const required = (value: string, code: string): void => {
  if (!value.trim()) throw new Error(code);
};

export const assertPspQualificationDecision = (
  decision: KyrubPspQualificationDecision
): KyrubPspQualificationDecision => {
  required(decision.assessedAt, 'PSP_ASSESSED_AT_REQUIRED');
  if (decision.commercialGate === 'approved') {
    required(decision.evidenceReference ?? '', 'PSP_COMMERCIAL_EVIDENCE_REQUIRED');
  }
  return decision;
};

export const canEnablePspSplitInProduction = (
  decision: KyrubPspQualificationDecision
): boolean => {
  assertPspQualificationDecision(decision);
  if (!decision.technicallySupported) return false;
  return decision.commercialGate === 'not_required' || decision.commercialGate === 'approved';
};

export const mercadoPagoOneToManyDefaultDecision = (
  assessedAt: string
): KyrubPspQualificationDecision => ({
  provider: 'mercado_pago',
  splitModel: 'one_to_many',
  technicallySupported: true,
  commercialGate: 'required',
  assessedAt,
});
