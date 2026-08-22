import {
  decryptIntegrationSecret,
  type EncryptedSecretEnvelope,
} from './secretVault';
import {
  parseGoogleSecretManagerRef,
  type GoogleSecretManagerVault,
  type KyrubVaultWriteResult,
} from './googleSecretManagerVault';

export type KyrubCredentialAuthority =
  | {
      kind: 'legacy_envelope';
      encryptedCredentials: EncryptedSecretEnvelope;
      associatedData: string;
    }
  | {
      kind: 'google_secret_manager';
      secretRef: string;
      version?: string;
    };

export interface StagedCredentialMigration {
  /** New authority to persist only when the legacy envelope is removed atomically. */
  nextAuthority: Extract<KyrubCredentialAuthority, { kind: 'google_secret_manager' }>;
  resourceName: string;
  /** The source remains authoritative until the caller performs the atomic cutover. */
  sourceAuthority: 'legacy_envelope';
  readyForAtomicCutover: true;
}

const required = (value: string, code: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
};

export const assertSingleCredentialAuthority = (
  value: unknown
): KyrubCredentialAuthority => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('KYRUB_CREDENTIAL_AUTHORITY_INVALID');
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === 'legacy_envelope') {
    if (
      !candidate.encryptedCredentials ||
      typeof candidate.encryptedCredentials !== 'object' ||
      Array.isArray(candidate.encryptedCredentials)
    ) {
      throw new Error('KYRUB_CREDENTIAL_LEGACY_ENVELOPE_REQUIRED');
    }
    required(candidate.associatedData as string, 'KYRUB_CREDENTIAL_LEGACY_AAD_REQUIRED');
    if ('secretRef' in candidate) {
      throw new Error('KYRUB_CREDENTIAL_MULTIPLE_AUTHORITIES');
    }
    return candidate as unknown as KyrubCredentialAuthority;
  }
  if (candidate.kind === 'google_secret_manager') {
    const secretRef = required(
      candidate.secretRef as string,
      'KYRUB_CREDENTIAL_SECRET_REF_REQUIRED'
    );
    parseGoogleSecretManagerRef(secretRef);
    if ('encryptedCredentials' in candidate) {
      throw new Error('KYRUB_CREDENTIAL_MULTIPLE_AUTHORITIES');
    }
    return {
      kind: 'google_secret_manager',
      secretRef,
      ...(typeof candidate.version === 'string' && candidate.version.trim()
        ? { version: candidate.version.trim() }
        : {}),
    };
  }
  throw new Error('KYRUB_CREDENTIAL_AUTHORITY_INVALID');
};

export const stageLegacyCredentialMigration = async <T>(input: {
  envelope: EncryptedSecretEnvelope;
  masterKey: Buffer;
  associatedData: string;
  targetSecretRef: string;
  vault: Pick<GoogleSecretManagerVault, 'addVersion'>;
}): Promise<StagedCredentialMigration> => {
  required(input.associatedData, 'KYRUB_CREDENTIAL_LEGACY_AAD_REQUIRED');
  parseGoogleSecretManagerRef(input.targetSecretRef);

  const plaintext = decryptIntegrationSecret<T>(
    input.envelope,
    input.masterKey,
    input.associatedData
  );
  const serialized = JSON.stringify(plaintext);
  const written: KyrubVaultWriteResult = await input.vault.addVersion(
    input.targetSecretRef,
    serialized
  );

  return {
    sourceAuthority: 'legacy_envelope',
    nextAuthority: {
      kind: 'google_secret_manager',
      secretRef: input.targetSecretRef,
      version: written.version,
    },
    resourceName: written.resourceName,
    readyForAtomicCutover: true,
  };
};
