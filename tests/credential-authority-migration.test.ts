import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertSingleCredentialAuthority,
  stageLegacyCredentialMigration,
} from '../server/integrations/credentialAuthorityMigration';
import { encryptIntegrationSecret } from '../server/integrations/secretVault';

const masterKey = Buffer.alloc(32, 7);

test('credential records reject legacy and GSM authorities in the same object', () => {
  const envelope = encryptIntegrationSecret(
    { clientId: 'client', clientSecret: 'secret' },
    masterKey,
    '99food:tenant-1'
  );
  assert.throws(
    () => assertSingleCredentialAuthority({
      kind: 'legacy_envelope',
      encryptedCredentials: envelope,
      associatedData: '99food:tenant-1',
      secretRef: 'gsm://projects/kyrub/secrets/tenant-1-99food',
    }),
    /KYRUB_CREDENTIAL_MULTIPLE_AUTHORITIES/
  );

  assert.throws(
    () => assertSingleCredentialAuthority({
      kind: 'google_secret_manager',
      secretRef: 'gsm://projects/kyrub/secrets/tenant-1-99food',
      encryptedCredentials: envelope,
    }),
    /KYRUB_CREDENTIAL_MULTIPLE_AUTHORITIES/
  );
});

test('legacy migration stages a GSM version without changing source authority', async () => {
  const credentials = {
    clientId: 'client-id',
    clientSecret: 'server-only-secret',
    merchantApiKey: 'merchant-key',
  };
  const envelope = encryptIntegrationSecret(
    credentials,
    masterKey,
    '99food:tenant-1'
  );
  let writtenValue = '';
  let writtenRef = '';

  const staged = await stageLegacyCredentialMigration<typeof credentials>({
    envelope,
    masterKey,
    associatedData: '99food:tenant-1',
    targetSecretRef: 'gsm://projects/kyrub/secrets/tenant-1-99food',
    vault: {
      async addVersion(secretRef, value) {
        writtenRef = secretRef;
        writtenValue = value;
        return {
          version: '4',
          resourceName: 'projects/kyrub/secrets/tenant-1-99food/versions/4',
        };
      },
    },
  });

  assert.equal(writtenRef, 'gsm://projects/kyrub/secrets/tenant-1-99food');
  assert.deepEqual(JSON.parse(writtenValue), credentials);
  assert.deepEqual(staged, {
    sourceAuthority: 'legacy_envelope',
    nextAuthority: {
      kind: 'google_secret_manager',
      secretRef: 'gsm://projects/kyrub/secrets/tenant-1-99food',
      version: '4',
    },
    resourceName: 'projects/kyrub/secrets/tenant-1-99food/versions/4',
    readyForAtomicCutover: true,
  });
});

test('failed staging never produces a cutover authority', async () => {
  const envelope = encryptIntegrationSecret(
    { clientId: 'client', clientSecret: 'secret' },
    masterKey,
    '99food:tenant-1'
  );
  await assert.rejects(
    () => stageLegacyCredentialMigration({
      envelope,
      masterKey,
      associatedData: '99food:tenant-1',
      targetSecretRef: 'gsm://projects/kyrub/secrets/tenant-1-99food',
      vault: {
        async addVersion() {
          throw new Error('KYRUB_VAULT_WRITE_FAILED:403');
        },
      },
    }),
    /KYRUB_VAULT_WRITE_FAILED:403/
  );
});
