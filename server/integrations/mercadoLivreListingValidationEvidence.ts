export type MercadoLivreListingValidationCauseType = 'warning' | 'error' | '';

export type MercadoLivreListingValidationCause = {
  code: string;
  message: string;
  reference: string;
  type: MercadoLivreListingValidationCauseType;
};

export type MercadoLivreListingValidationDisposition =
  | 'accepted'
  | 'warning_only'
  | 'blocked';

export type MercadoLivreListingValidationEvidenceClassification = {
  status: 'ready_for_owner_authorization' | 'needs_correction';
  disposition: MercadoLivreListingValidationDisposition;
  warningCount: number;
  blockingCauseCount: number;
};

const clean = (value: unknown, maximum = 2_000): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const normalizeCauseType = (value: unknown): MercadoLivreListingValidationCauseType => {
  const normalized = clean(value, 40).toLocaleLowerCase('en-US');
  if (normalized === 'warning') return 'warning';
  if (normalized === 'error') return 'error';
  return '';
};

const normalizeCause = (value: unknown): MercadoLivreListingValidationCause | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const cause = value as Record<string, unknown>;
  const code = clean(cause.code, 120);
  const message = clean(cause.message, 600);
  const references = Array.isArray(cause.references)
    ? cause.references.map(item => clean(item, 240)).filter(Boolean)
    : [];
  const reference = clean(cause.reference, 240) || references.join(', ').slice(0, 240);
  const type = normalizeCauseType(cause.type ?? cause.severity ?? cause.level);
  if (!code && !message && !reference) return null;
  return { code, message, reference, type };
};

export const mercadoLivreProviderValidationCauses = (
  payload: unknown
): MercadoLivreListingValidationCause[] => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const record = payload as Record<string, unknown>;
  const raw = Array.isArray(record.cause) ? record.cause : [];
  return raw.flatMap(value => {
    const cause = normalizeCause(value);
    return cause ? [cause] : [];
  }).slice(0, 30);
};

export const mercadoLivrePersistedValidationCauses = (
  value: unknown
): MercadoLivreListingValidationCause[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap(candidate => {
    const cause = normalizeCause(candidate);
    return cause ? [cause] : [];
  }).slice(0, 30);
};

export const classifyMercadoLivreListingValidationEvidence = (input: {
  providerStatus: number;
  causes: readonly MercadoLivreListingValidationCause[];
}): MercadoLivreListingValidationEvidenceClassification => {
  const warningCount = input.causes.filter(cause => cause.type === 'warning').length;
  const blockingCauseCount = input.causes.filter(cause => cause.type !== 'warning').length;
  const accepted204 = input.providerStatus === 204 && blockingCauseCount === 0;
  const warningOnly400 =
    input.providerStatus === 400 &&
    input.causes.length > 0 &&
    warningCount === input.causes.length &&
    blockingCauseCount === 0;

  if (accepted204) {
    return {
      status: 'ready_for_owner_authorization',
      disposition: 'accepted',
      warningCount,
      blockingCauseCount: 0,
    };
  }
  if (warningOnly400) {
    return {
      status: 'ready_for_owner_authorization',
      disposition: 'warning_only',
      warningCount,
      blockingCauseCount: 0,
    };
  }
  return {
    status: 'needs_correction',
    disposition: 'blocked',
    warningCount,
    blockingCauseCount,
  };
};

export const isMercadoLivreReadyListingValidationEvidence = (
  value: unknown
): boolean => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const providerStatus = Number(record.providerStatus);
  if (!Number.isSafeInteger(providerStatus)) return false;
  const causes = mercadoLivrePersistedValidationCauses(record.causes);
  const classification = classifyMercadoLivreListingValidationEvidence({ providerStatus, causes });
  return record.status === 'ready_for_owner_authorization' &&
    classification.status === 'ready_for_owner_authorization' &&
    record.providerDisposition === classification.disposition &&
    Number(record.providerWarningCount) === classification.warningCount &&
    Number(record.providerBlockingCauseCount) === classification.blockingCauseCount;
};
