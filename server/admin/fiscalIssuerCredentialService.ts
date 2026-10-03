import { authorizeIntegrationReadiness } from './integrationReadinessService.js';
import { loadFiscalIssuerCredentialMetadata, saveFiscalIssuerCredential } from '../integrations/fiscalIssuerCredentialStore.js';
import { validateFocusIssuerHomologationCredential } from '../integrations/focusIssuerCredentialValidation.js';

const clean = (value: unknown, maxLength = 160): string => typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const authorizeStore = async (authorization: string, canonicalStoreIdInput: unknown) => {
  await authorizeIntegrationReadiness(authorization);
  const canonicalStoreId = clean(canonicalStoreIdInput);
  if (!canonicalStoreId) throw new Error('FISCAL_ISSUER_STORE_REQUIRED');
  return canonicalStoreId;
};

export const loadAuthorizedFiscalIssuerCredentialStatus = async (input: { authorization: string; canonicalStoreId: unknown }) => {
  const canonicalStoreId = await authorizeStore(input.authorization, input.canonicalStoreId);
  const credential = await loadFiscalIssuerCredentialMetadata(canonicalStoreId, 'homologation');
  return { canonicalStoreId, environment: 'homologation' as const, configured: Boolean(credential?.configured), status: credential?.status ?? 'missing', tokenLast4: credential?.tokenLast4 ?? '', lastValidationCode: credential?.lastValidationCode };
};

export const saveAuthorizedFiscalIssuerCredential = async (input: { authorization: string; canonicalStoreId: unknown; token: unknown }) => {
  const canonicalStoreId = await authorizeStore(input.authorization, input.canonicalStoreId);
  return saveFiscalIssuerCredential({ canonicalStoreId, environment: 'homologation', token: input.token });
};

export const validateAuthorizedFiscalIssuerCredential = async (input: { authorization: string; canonicalStoreId: unknown }) => {
  const canonicalStoreId = await authorizeStore(input.authorization, input.canonicalStoreId);
  return validateFocusIssuerHomologationCredential(canonicalStoreId);
};

export const mapFiscalIssuerCredentialError = (error: unknown): { status: number; body: { error: string; code: string } } => {
  const message = error instanceof Error ? error.message : String(error);
  if (/AUTH_REQUIRED|id-token|expired|revoked/i.test(message)) return { status: 401, body: { error: 'Faça login novamente.', code: 'AUTH_REQUIRED' } };
  if (message === 'EMAIL_NOT_VERIFIED' || message === 'FORBIDDEN') return { status: 403, body: { error: 'Somente Super Admin pode configurar credenciais fiscais de emitentes.', code: message } };
  if (message === 'FISCAL_ISSUER_STORE_REQUIRED') return { status: 400, body: { error: 'Selecione uma loja válida.', code: message } };
  if (message === 'FISCAL_ISSUER_TOKEN_REQUIRED' || message === 'FISCAL_ISSUER_TOKEN_TOO_LARGE') return { status: 400, body: { error: 'Informe um Token Homologação válido.', code: message } };
  if (/INTEGRATION_MASTER_KEY/i.test(message)) return { status: 503, body: { error: 'O cofre seguro da plataforma não está disponível.', code: 'VAULT_UNAVAILABLE' } };
  console.error('[Admin Fiscal Issuer Credential]', message);
  return { status: 503, body: { error: 'Não foi possível concluir a configuração fiscal do emitente agora.', code: 'FISCAL_ISSUER_CREDENTIAL_OPERATION_FAILED' } };
};
