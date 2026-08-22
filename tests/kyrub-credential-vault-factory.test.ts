import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createKyrubCredentialVault,
  kyrubCredentialVaultConfig,
} from '../server/integrations/kyrubCredentialVault';

const withVaultFlag = async (
  value: string | undefined,
  run: () => void | Promise<void>
): Promise<void> => {
  const previous = process.env.KYRUB_GOOGLE_SECRET_MANAGER_ENABLED;
  try {
    if (value === undefined) delete process.env.KYRUB_GOOGLE_SECRET_MANAGER_ENABLED;
    else process.env.KYRUB_GOOGLE_SECRET_MANAGER_ENABLED = value;
    await run();
  } finally {
    if (previous === undefined) delete process.env.KYRUB_GOOGLE_SECRET_MANAGER_ENABLED;
    else process.env.KYRUB_GOOGLE_SECRET_MANAGER_ENABLED = previous;
  }
};

test('credential vault is disabled unless explicitly enabled', async () => {
  await withVaultFlag(undefined, () => {
    assert.deepEqual(kyrubCredentialVaultConfig(), {
      enabled: false,
      backend: 'disabled',
    });
    assert.throws(
      () => createKyrubCredentialVault(),
      /KYRUB_CREDENTIAL_VAULT_DISABLED/
    );
  });

  await withVaultFlag('false', () => {
    assert.equal(kyrubCredentialVaultConfig().enabled, false);
  });
});

test('only the explicit true value enables the Google Secret Manager backend', async () => {
  await withVaultFlag('TRUE', () => {
    assert.deepEqual(kyrubCredentialVaultConfig(), {
      enabled: true,
      backend: 'google-secret-manager',
    });
  });

  await withVaultFlag('1', () => {
    assert.equal(kyrubCredentialVaultConfig().enabled, false);
  });
});

test('enabled factory can use injected server dependencies without touching live credentials', async () => {
  await withVaultFlag('true', async () => {
    let tokenCalls = 0;
    let fetchCalls = 0;
    const vault = createKyrubCredentialVault({
      tokenProvider: {
        async getAccessToken() {
          tokenCalls += 1;
          return 'injected-test-token';
        },
      },
      fetchImpl: async (_url, init) => {
        fetchCalls += 1;
        assert.equal(
          (init?.headers as Record<string, string>).authorization,
          'Bearer injected-test-token'
        );
        return new Response(JSON.stringify({
          name: 'projects/test-project/secrets/provider-token/versions/3',
          payload: {
            data: Buffer.from('test-secret-value', 'utf8').toString('base64'),
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    const result = await vault.readLatest(
      'gsm://projects/test-project/secrets/provider-token'
    );
    assert.equal(result.value, 'test-secret-value');
    assert.equal(result.version, '3');
    assert.equal(tokenCalls, 1);
    assert.equal(fetchCalls, 1);
  });
});
