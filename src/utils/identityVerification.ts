export type VerificationProfile =
  | 'requester'
  | 'freelancer'
  | 'bicycle_courier'
  | 'motorized_courier';

export type VerificationStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'rejected';

export type AdditionalCourierProfile = 'bicycle_courier' | 'motorized_courier';

export type ProfileExpansion = {
  profile: AdditionalCourierProfile;
  status: 'submitted' | 'approved' | 'rejected';
  cnhCategory: string;
  cnhHasEar: boolean;
  documentPaths: string[];
  submittedAt?: unknown;
  reviewedAt?: unknown;
  reviewedBy: string;
  reviewReason: string;
};

export type IdentityDocumentType = 'cin' | 'rg' | 'cnh';

export type IdentityVerificationRecord = {
  uid: string;
  status: VerificationStatus;
  requestedProfiles: VerificationProfile[];
  approvedProfiles: VerificationProfile[];
  fullName: string;
  cpf: string;
  address: string;
  whatsapp: string;
  documentType: IdentityDocumentType;
  documentPaths: string[];
  selfiePath: string;
  cnhCategory: string;
  cnhHasEar: boolean;
  consentVersion: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  submittedAt?: unknown;
  reviewedAt?: unknown;
  reviewedBy?: string;
  reviewReason?: string;
  profileExpansion?: ProfileExpansion;
};

export type WorkAction =
  | 'request_freelance'
  | 'apply_freelance'
  | 'request_delivery'
  | 'accept_delivery';

export const IDENTITY_VERIFICATION_COLLECTION = 'identity_verifications';
export const IDENTITY_VERIFICATION_OPEN_EVENT = 'kyrub-open-identity-verification';
export const IDENTITY_CONSENT_VERSION = '2026-08-01';

export type IdentityVerificationSection = 'conta' | 'dados' | 'seguranca' | 'documentos' | 'validacao';

// Both Meu Perfil and Renda → Entregas open the same private identity record.
export const openIdentityVerification = (section: IdentityVerificationSection = 'conta'): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(IDENTITY_VERIFICATION_OPEN_EVENT, {
    detail: { section },
  }));
};

export const courierVerificationSummary = (
  record: IdentityVerificationRecord | null
): { label: string; description: string; canAccept: boolean } => {
  if (!record || record.status === 'draft') {
    return {
      label: 'Cadastro pendente',
      description: 'Escolha sua modalidade e envie os documentos no cadastro de identidade.',
      canAccept: false,
    };
  }
  if (record.status === 'submitted' || record.status === 'under_review') {
    return {
      label: 'Em análise',
      description: 'Você pode consultar oportunidades; aceitar exige aprovação da equipe.',
      canAccept: false,
    };
  }
  if (record.status === 'rejected') {
    return {
      label: 'Correção necessária',
      description: 'Consulte o motivo da revisão na sua área privada de verificação.',
      canAccept: false,
    };
  }
  const courierApproved = record.approvedProfiles.includes('bicycle_courier')
    || record.approvedProfiles.includes('motorized_courier');
  if (courierApproved) {
    return {
      label: 'Entregador aprovado',
      description: 'Aceites dependem ainda das regras específicas do pedido e do veículo.',
      canAccept: true,
    };
  }
  if (record.profileExpansion?.status === 'submitted') {
    return {
      label: 'Habilitação em análise',
      description: 'Sua atividade anterior continua aprovada. Entregas aguardam a nova análise.',
      canAccept: false,
    };
  }
  if (record.profileExpansion?.status === 'rejected') {
    return {
      label: 'Habilitação: corrigir',
      description: 'A solicitação adicional precisa de correção. Consulte a central de verificação.',
      canAccept: false,
    };
  }
  return {
    label: 'Outra atividade aprovada',
    description: 'A aprovação atual não inclui entregas. Solicite uma nova modalidade.',
    canAccept: false,
  };
};

const onlyDigits = (value: string): string => value.replace(/\D/g, '');

export const formatCpf = (value: string): string => {
  const digits = onlyDigits(value).slice(0, 11);
  return digits
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
};

export const isValidCpf = (value: string): boolean => {
  const digits = onlyDigits(value);
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;

  const calculate = (length: number): number => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) {
      sum += Number(digits[index]) * (length + 1 - index);
    }
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  return calculate(9) === Number(digits[9])
    && calculate(10) === Number(digits[10]);
};

export const emptyIdentityVerification = (
  uid: string,
  fullName = ''
): IdentityVerificationRecord => ({
  uid,
  status: 'draft',
  requestedProfiles: [],
  approvedProfiles: [],
  fullName,
  cpf: '',
  address: '',
  whatsapp: '',
  documentType: 'cin',
  documentPaths: [],
  selfiePath: '',
  cnhCategory: '',
  cnhHasEar: false,
  consentVersion: IDENTITY_CONSENT_VERSION,
});

export const mapIdentityVerification = (
  uid: string,
  value: Record<string, unknown> | undefined,
  fallbackName = ''
): IdentityVerificationRecord => {
  const stringValue = (key: string): string =>
    typeof value?.[key] === 'string' ? String(value[key]) : '';
  const profileList = (key: string): VerificationProfile[] =>
    Array.isArray(value?.[key])
      ? value[key].filter((item): item is VerificationProfile =>
          item === 'requester'
          || item === 'freelancer'
          || item === 'bicycle_courier'
          || item === 'motorized_courier'
        )
      : [];
  const status = value?.status;
  const documentType = value?.documentType;
  const expansion = value?.profileExpansion as Record<string, unknown> | undefined;
  const expansionProfile = expansion?.profile;
  const expansionStatus = expansion?.status;

  return {
    uid,
    status:
      status === 'submitted'
      || status === 'under_review'
      || status === 'approved'
      || status === 'rejected'
        ? status
        : 'draft',
    requestedProfiles: profileList('requestedProfiles'),
    approvedProfiles: profileList('approvedProfiles'),
    fullName: stringValue('fullName') || fallbackName,
    cpf: stringValue('cpf'),
    address: stringValue('address'),
    whatsapp: stringValue('whatsapp'),
    documentType:
      documentType === 'rg' || documentType === 'cnh'
        ? documentType
        : 'cin',
    documentPaths: Array.isArray(value?.documentPaths)
      ? value.documentPaths.filter((item): item is string => typeof item === 'string')
      : [],
    selfiePath: stringValue('selfiePath'),
    cnhCategory: stringValue('cnhCategory'),
    cnhHasEar: value?.cnhHasEar === true,
    consentVersion: stringValue('consentVersion') || IDENTITY_CONSENT_VERSION,
    createdAt: value?.createdAt,
    updatedAt: value?.updatedAt,
    submittedAt: value?.submittedAt,
    reviewedAt: value?.reviewedAt,
    reviewedBy: stringValue('reviewedBy'),
    reviewReason: stringValue('reviewReason'),
    profileExpansion:
      (expansionProfile === 'bicycle_courier' || expansionProfile === 'motorized_courier')
      && (expansionStatus === 'submitted' || expansionStatus === 'approved' || expansionStatus === 'rejected')
        ? {
            profile: expansionProfile,
            status: expansionStatus,
            cnhCategory: typeof expansion?.cnhCategory === 'string' ? expansion.cnhCategory : '',
            cnhHasEar: expansion?.cnhHasEar === true,
            documentPaths: Array.isArray(expansion?.documentPaths)
              ? expansion.documentPaths.filter((path): path is string => typeof path === 'string')
              : [],
            submittedAt: expansion.submittedAt,
            reviewedAt: expansion.reviewedAt,
            reviewedBy: typeof expansion.reviewedBy === 'string' ? expansion.reviewedBy : '',
            reviewReason: typeof expansion.reviewReason === 'string' ? expansion.reviewReason : '',
          }
        : undefined,
  };
};

export const requiredProfileForAction = (
  action: WorkAction
): VerificationProfile | 'courier' => {
  if (action === 'apply_freelance') return 'freelancer';
  if (action === 'accept_delivery') return 'courier';
  return 'requester';
};

export const workEligibility = (
  verification: IdentityVerificationRecord | null,
  action: WorkAction
): { allowed: boolean; reason: string } => {
  if (!verification || verification.status !== 'approved') {
    return {
      allowed: false,
      reason:
        verification?.status === 'submitted' || verification?.status === 'under_review'
          ? 'Sua verificação está em análise. Esta ação será liberada após a aprovação.'
          : verification?.status === 'rejected'
            ? verification.reviewReason || 'Sua verificação precisa ser corrigida antes desta ação.'
            : 'Conclua a verificação de identidade e documentos para usar esta função.',
    };
  }

  const required = requiredProfileForAction(action);
  const approved = new Set(verification.approvedProfiles);
  const allowed = required === 'courier'
    ? approved.has('bicycle_courier') || approved.has('motorized_courier')
    : approved.has(required);

  return {
    allowed,
    reason: allowed
      ? ''
      : required === 'courier'
        ? 'Seu perfil aprovado ainda não inclui entregas de bicicleta ou motorizadas.'
        : 'Seu perfil aprovado ainda não inclui esta modalidade de trabalho.',
  };
};

export const verificationRequirements = (
  record: IdentityVerificationRecord
): string[] => {
  const requirements = [
    'CPF válido',
    'documento oficial com foto',
    'selfie para comparação e prova de vida assistida',
  ];

  if (record.requestedProfiles.includes('motorized_courier')) {
    requirements.push('CNH compatível e válida');
    requirements.push('observação EAR para atividade remunerada');
  }

  return requirements;
};
