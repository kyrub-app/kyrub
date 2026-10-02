import { markFiscalIssuerCredentialValidation, resolveFiscalIssuerCredential } from './fiscalIssuerCredentialStore.js';

const HOMOLOGATION_BASE_URL = 'https://homologacao.focusnfe.com.br';
const SENTINEL_REFERENCE = 'kyrub-credential-probe-never-issued';

export interface FocusIssuerCredentialValidationResult {
  ok: boolean;
  code: 'authenticated_not_found' | 'unauthorized' | 'forbidden' | 'unexpected_status' | 'network_error' | 'credential_missing';
  httpStatus?: number;
}

export const validateFocusIssuerHomologationCredential = async (canonicalStoreId: string): Promise<FocusIssuerCredentialValidationResult> => {
  const credential = await resolveFiscalIssuerCredential(canonicalStoreId, 'homologation');
  if (!credential) return { ok: false, code: 'credential_missing' };

  let result: FocusIssuerCredentialValidationResult;
  try {
    const authorization = Buffer.from(`${credential.token}:`, 'utf8').toString('base64');
    const response = await fetch(`${HOMOLOGATION_BASE_URL}/v2/nfce/${SENTINEL_REFERENCE}`, {
      method: 'GET',
      headers: { Authorization: `Basic ${authorization}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    });
    if (response.status === 404) result = { ok: true, code: 'authenticated_not_found', httpStatus: 404 };
    else if (response.status === 401) result = { ok: false, code: 'unauthorized', httpStatus: 401 };
    else if (response.status === 403) result = { ok: false, code: 'forbidden', httpStatus: 403 };
    else result = { ok: false, code: 'unexpected_status', httpStatus: response.status };
  } catch {
    result = { ok: false, code: 'network_error' };
  }

  await markFiscalIssuerCredentialValidation({ canonicalStoreId, environment: 'homologation', ok: result.ok, code: result.code });
  return result;
};
