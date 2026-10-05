import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, getFirebaseAdminProjectId } from '../firebaseAdmin.js';
import { createKyrubCredentialVault } from '../integrations/kyrubCredentialVault.js';
import { parseGoogleSecretManagerRef } from '../integrations/googleSecretManagerVault.js';
import { authorizeOwnFiscalStore } from './fiscalStoreAuthorization.js';

const MAX_SECRET_BYTES = 64 * 1024;
const clean = (value: unknown, maxLength: number): string =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const metadataPath = (canonicalStoreId: string): string =>
  `kyrub_admin/fiscal/store_credentials/${canonicalStoreId}`;

const storeDigest = (canonicalStoreId: string): string =>
  createHash('sha256').update(canonicalStoreId, 'utf8').digest('hex').slice(0, 32);

const secretRef = (canonicalStoreId: string, kind: 'a1' | 'nfce-csc'): string => {
  const projectId = getFirebaseAdminProjectId();
  const ref = `gsm://projects/${projectId}/secrets/kyrub-fiscal-${kind}-${storeDigest(canonicalStoreId)}`;
  parseGoogleSecretManagerRef(ref);
  return ref;
};

const isoNow = (): string => new Date().toISOString();
const assertSecretSize = (value: string): void => {
  if (Buffer.byteLength(value, 'utf8') > MAX_SECRET_BYTES) {
    throw new Error('FISCAL_CREDENTIAL_SECRET_TOO_LARGE');
  }
};

const decodeCertificate = (value: unknown): Buffer => {
  const encoded = clean(value, 96 * 1024).replace(/\s+/g, '');
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error('FISCAL_A1_CERTIFICATE_INVALID');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.toString('base64').replace(/=+$/u, '') !== encoded.replace(/=+$/u, '')) {
    throw new Error('FISCAL_A1_CERTIFICATE_INVALID');
  }
  return bytes;
};

const safeFileName = (value: unknown): string => {
  const name = clean(value, 180).replace(/[\\/\0\r\n]/g, '_');
  if (!name || !/\.(pfx|p12)$/i.test(name)) throw new Error('FISCAL_A1_FILE_INVALID');
  return name;
};

type CredentialNode = Record<string, unknown>;

export interface FiscalStoreCredentialStatus {
  canonicalStoreId: string;
  certificateA1: {
    configured: boolean;
    fileName: string | null;
    fingerprintSha256: string | null;
    byteLength: number | null;
    updatedAt: string | null;
  };
  nfceCsc: {
    configured: boolean;
    cscId: string | null;
    updatedAt: string | null;
  };
  authority: 'google_secret_manager';
  productionTrafficAllowed: false;
}

const toStatus = (canonicalStoreId: string, data: Record<string, unknown>): FiscalStoreCredentialStatus => {
  const a1 = data.a1 && typeof data.a1 === 'object' && !Array.isArray(data.a1) ? data.a1 as CredentialNode : {};
  const csc = data.nfceCsc && typeof data.nfceCsc === 'object' && !Array.isArray(data.nfceCsc) ? data.nfceCsc as CredentialNode : {};
  const a1Configured = a1.configured === true && clean(a1.secretRef, 400) === secretRef(canonicalStoreId, 'a1') && Boolean(clean(a1.version, 80));
  const cscConfigured = csc.configured === true && clean(csc.secretRef, 400) === secretRef(canonicalStoreId, 'nfce-csc') && Boolean(clean(csc.version, 80));
  return {
    canonicalStoreId,
    certificateA1: {
      configured: a1Configured,
      fileName: a1Configured ? clean(a1.fileName, 180) || null : null,
      fingerprintSha256: a1Configured ? clean(a1.fingerprintSha256, 64) || null : null,
      byteLength: a1Configured && typeof a1.byteLength === 'number' ? a1.byteLength : null,
      updatedAt: a1Configured ? clean(a1.updatedAt, 64) || null : null,
    },
    nfceCsc: {
      configured: cscConfigured,
      cscId: cscConfigured ? clean(csc.cscId, 20) || null : null,
      updatedAt: cscConfigured ? clean(csc.updatedAt, 64) || null : null,
    },
    authority: 'google_secret_manager',
    productionTrafficAllowed: false,
  };
};

export const loadFiscalStoreCredentialStatus = async (canonicalStoreId: string): Promise<FiscalStoreCredentialStatus> => {
  const snapshot = await adminDb.doc(metadataPath(canonicalStoreId)).get();
  return toStatus(canonicalStoreId, snapshot.data() ?? {});
};

export const loadOwnFiscalStoreCredentialStatus = async (input: {
  authorization: string;
  canonicalStoreId: unknown;
}): Promise<FiscalStoreCredentialStatus> => {
  const authorized = await authorizeOwnFiscalStore(input);
  return loadFiscalStoreCredentialStatus(authorized.canonicalStoreId);
};

export const saveOwnFiscalA1Credential = async (input: {
  authorization: string;
  canonicalStoreId: unknown;
  fileName: unknown;
  certificateBase64: unknown;
  password: unknown;
}): Promise<FiscalStoreCredentialStatus> => {
  const authorized = await authorizeOwnFiscalStore(input);
  const fileName = safeFileName(input.fileName);
  const password = clean(input.password, 512);
  if (!password) throw new Error('FISCAL_A1_PASSWORD_REQUIRED');
  const certificate = decodeCertificate(input.certificateBase64);
  const certificateBase64 = certificate.toString('base64');
  const fingerprintSha256 = createHash('sha256').update(certificate).digest('hex');
  const value = JSON.stringify({ schemaVersion: 1, kind: 'fiscal_a1', format: 'pkcs12-base64', certificateBase64, password });
  assertSecretSize(value);

  const ref = secretRef(authorized.canonicalStoreId, 'a1');
  const vault = createKyrubCredentialVault();
  await vault.ensureSecret(ref);
  const written = await vault.addVersion(ref, value);
  const updatedAt = isoNow();
  await adminDb.doc(metadataPath(authorized.canonicalStoreId)).set({
    schemaVersion: 1,
    canonicalStoreId: authorized.canonicalStoreId,
    authority: 'google_secret_manager',
    a1: {
      configured: true,
      secretRef: ref,
      version: written.version,
      fileName,
      fingerprintSha256,
      byteLength: certificate.byteLength,
      updatedAt,
      updatedByUserId: authorized.actorId,
    },
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return loadFiscalStoreCredentialStatus(authorized.canonicalStoreId);
};

export const saveOwnFiscalNfceCscCredential = async (input: {
  authorization: string;
  canonicalStoreId: unknown;
  cscId: unknown;
  csc: unknown;
}): Promise<FiscalStoreCredentialStatus> => {
  const authorized = await authorizeOwnFiscalStore(input);
  const cscId = clean(input.cscId, 20);
  const csc = clean(input.csc, 128);
  if (!cscId || !/^[A-Za-z0-9._-]+$/.test(cscId)) throw new Error('FISCAL_NFCE_CSC_ID_INVALID');
  if (!csc) throw new Error('FISCAL_NFCE_CSC_REQUIRED');
  const value = JSON.stringify({ schemaVersion: 1, kind: 'nfce_csc', cscId, csc });
  assertSecretSize(value);

  const ref = secretRef(authorized.canonicalStoreId, 'nfce-csc');
  const vault = createKyrubCredentialVault();
  await vault.ensureSecret(ref);
  const written = await vault.addVersion(ref, value);
  const updatedAt = isoNow();
  await adminDb.doc(metadataPath(authorized.canonicalStoreId)).set({
    schemaVersion: 1,
    canonicalStoreId: authorized.canonicalStoreId,
    authority: 'google_secret_manager',
    nfceCsc: {
      configured: true,
      secretRef: ref,
      version: written.version,
      cscId,
      updatedAt,
      updatedByUserId: authorized.actorId,
    },
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return loadFiscalStoreCredentialStatus(authorized.canonicalStoreId);
};

export const mapFiscalStoreCredentialError = (error: unknown): { status: number; body: { error: string; code: string } } => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'AUTH_REQUIRED' || /id-token|expired|revoked/i.test(message)) return { status: 401, body: { error: 'Faça login novamente.', code: 'AUTH_REQUIRED' } };
  if (message === 'EMAIL_NOT_VERIFIED' || message === 'FISCAL_STORE_OWNERSHIP_REQUIRED') return { status: 403, body: { error: 'As credenciais fiscais só podem ser configuradas pela própria loja autenticada.', code: message } };
  if (message === 'FISCAL_STORE_NOT_FOUND') return { status: 404, body: { error: 'A loja autenticada não foi encontrada.', code: message } };
  if (message === 'FISCAL_STORE_IDENTITY_INVALID') return { status: 409, body: { error: 'A identidade canônica da loja está inconsistente.', code: message } };
  if (message === 'FISCAL_CREDENTIAL_SECRET_TOO_LARGE' || message === 'KYRUB_VAULT_SECRET_VALUE_TOO_LARGE') return { status: 413, body: { error: 'O arquivo do certificado excede o limite seguro suportado.', code: 'FISCAL_CREDENTIAL_SECRET_TOO_LARGE' } };
  if (['FISCAL_STORE_REQUIRED', 'FISCAL_A1_CERTIFICATE_INVALID', 'FISCAL_A1_FILE_INVALID', 'FISCAL_A1_PASSWORD_REQUIRED', 'FISCAL_NFCE_CSC_ID_INVALID', 'FISCAL_NFCE_CSC_REQUIRED'].includes(message)) return { status: 400, body: { error: 'Revise os dados da credencial fiscal informada.', code: message } };
  if (message === 'KYRUB_CREDENTIAL_VAULT_DISABLED' || /^KYRUB_VAULT_/.test(message)) return { status: 503, body: { error: 'O cofre seguro de credenciais fiscais não está disponível agora.', code: 'FISCAL_CREDENTIAL_VAULT_UNAVAILABLE' } };
  console.error('[Fiscal Store Credential]', error instanceof Error ? error.message : 'unknown');
  return { status: 503, body: { error: 'Não foi possível salvar a credencial fiscal agora.', code: 'FISCAL_STORE_CREDENTIAL_FAILED' } };
};
