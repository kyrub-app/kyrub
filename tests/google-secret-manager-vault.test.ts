import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GoogleSecretManagerVault,
  parseGoogleSecretManagerRef,
  type KyrubVaultAccessTokenProvider,
} from '../server/integrations/googleSecretManagerVault';

const tokenProvider: KyrubVaultAccessTokenProvider = {
  async getAccessToken() {
    return 'server-access-token';
  },
};

test('Google Secret Manager refs are explicit and bounded', () => {
  assert.deepEqual(
    parseGoogleSecretManagerRef('gsm://projects/kyrub-prod/secrets/mercado_pago_access_token'),
    {
      projectId: 'kyrub-prod',
      secretId: 'mercado_pago_access_token',
      parent: 'projects/kyrub-prod/secrets/mercado_pago_access_token',
    }
  );
  assert.throws(
    () => parseGoogleSecretManagerRef('vault://mercado-pago/access-token'),
    /KYRUB_VAULT_SECRET_REF_INVALID/
  );
  assert.throws(
    () => parseGoogleSecretManagerRef('gsm://projects/kyrub-prod/secrets/../../other'),
    /KYRUB_VAULT_SECRET_REF_INVALID/
  );
});

test('readLatest uses the Secret Manager access endpoint and decodes the payload', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const vault = new GoogleSecretManagerVault(tokenProvider, async (url, init) => {
    requestUrl = url;
    requestInit = init;
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          name: 'projects/kyrub-prod/secrets/provider-token/versions/7',
          payload: { data: Buffer.from('protected-provider-value', 'utf8').toString('base64') },
        };
      },
    };
  });

  const result = await vault.readLatest('gsm://projects/kyrub-prod/secrets/provider-token');
  assert.equal(
    requestUrl,
    'https://secretmanager.googleapis.com/v1/projects/kyrub-prod/secrets/provider-token/versions/latest:access'
  );
  assert.equal(requestInit?.method, 'GET');
  assert.equal((requestInit?.headers as Record<string, string>).authorization, 'Bearer server-access-token');
  assert.deepEqual(result, {
    value: 'protected-provider-value',
    version: '7',
    resourceName: 'projects/kyrub-prod/secrets/provider-token/versions/7',
  });
});

test('addVersion sends only a base64 payload to an existing Secret Manager secret', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const vault = new GoogleSecretManagerVault(tokenProvider, async (url, init) => {
    requestUrl = url;
    requestInit = init;
    return {
      ok: true,
      status: 200,
      async json() {
        return { name: 'projects/kyrub-prod/secrets/provider-token/versions/8' };
      },
    };
  });

  const result = await vault.addVersion(
    'gsm://projects/kyrub-prod/secrets/provider-token',
    'new-provider-value'
  );
  assert.equal(
    requestUrl,
    'https://secretmanager.googleapis.com/v1/projects/kyrub-prod/secrets/provider-token:addVersion'
  );
  assert.equal(requestInit?.method, 'POST');
  const headers = requestInit?.headers as Record<string, string>;
  assert.equal(headers.authorization, 'Bearer server-access-token');
  assert.match(headers['content-type'], /application\/json/);
  const body = JSON.parse(String(requestInit?.body)) as { payload?: { data?: string } };
  assert.equal(
    body.payload?.data,
    Buffer.from('new-provider-value', 'utf8').toString('base64')
  );
  assert.equal(String(requestInit?.body).includes('new-provider-value'), false);
  assert.deepEqual(result, {
    version: '8',
    resourceName: 'projects/kyrub-prod/secrets/provider-token/versions/8',
  });
});

test('vault rejects empty or oversized values before any network call', async () => {
  let calls = 0;
  const vault = new GoogleSecretManagerVault(tokenProvider, async () => {
    calls += 1;
    throw new Error('network should not be reached');
  });

  await assert.rejects(
    () => vault.addVersion('gsm://projects/kyrub-prod/secrets/provider-token', ''),
    /KYRUB_VAULT_SECRET_VALUE_REQUIRED/
  );
  await assert.rejects(
    () => vault.addVersion(
      'gsm://projects/kyrub-prod/secrets/provider-token',
      'x'.repeat(64 * 1024 + 1)
    ),
    /KYRUB_VAULT_SECRET_VALUE_TOO_LARGE/
  );
  assert.equal(calls, 0);
});

test('HTTP failures and malformed responses fail closed without leaking secret values', async () => {
  const secretValue = 'provider-secret-that-must-not-appear-in-errors';
  const failingVault = new GoogleSecretManagerVault(tokenProvider, async () => ({
    ok: false,
    status: 403,
    async json() { return { error: { message: secretValue } }; },
  }));

  await assert.rejects(
    () => failingVault.addVersion('gsm://projects/kyrub-prod/secrets/provider-token', secretValue),
    error => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'KYRUB_VAULT_WRITE_FAILED:403');
      assert.equal(error.message.includes(secretValue), false);
      return true;
    }
  );

  const malformedVault = new GoogleSecretManagerVault(tokenProvider, async () => ({
    ok: true,
    status: 200,
    async json() { return { payload: {} }; },
  }));
  await assert.rejects(
    () => malformedVault.readLatest('gsm://projects/kyrub-prod/secrets/provider-token'),
    /KYRUB_VAULT_ACCESS_RESPONSE_INVALID/
  );
});
