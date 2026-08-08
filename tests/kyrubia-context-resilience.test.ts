import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readSources = async () => {
  const [renda, profileRecovery, app] = await Promise.all([
    readFile(
      new URL('../src/components/tabs/RendaTab.tsx', import.meta.url),
      'utf8'
    ),
    readFile(
      new URL('../src/components/ProfileIdentityRecoveryBridge.tsx', import.meta.url),
      'utf8'
    ),
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  ]);
  return { renda, profileRecovery, app };
};

test('activated-store entry uses authenticated local cache before remote verification', async () => {
  const { renda } = await readSources();

  assert.match(renda, /loadCachedUserStore/);
  assert.match(renda, /const cachedConfigured =/);
  assert.match(renda, /setHasConfiguredStore\(cachedConfigured\)/);
  assert.match(renda, /setIsCheckingStore\(!cachedConfigured\)/);
  assert.match(renda, /configured \|\| cachedConfigured/);
});

test('store verification is bounded and never leaves activation entry blocked forever', async () => {
  const { renda } = await readSources();

  assert.match(renda, /STORE_CHECK_TIMEOUT_MS = 4_000/);
  assert.match(renda, /window\.setTimeout/);
  assert.match(renda, /setIsCheckingStore\(false\)/);
  assert.match(renda, /'Ativar loja'/);
  assert.match(renda, /'Acessar loja'/);
});

test('remote store failure preserves an already known configured store', async () => {
  const { renda } = await readSources();

  assert.match(renda, /if \(!cancelled && cachedConfigured\)/);
  assert.match(renda, /setHasConfiguredStore\(true\)/);
});

test('profile recovery bridge is mounted and prioritizes the Kyrub public profile identity', async () => {
  const { profileRecovery, app } = await readSources();

  assert.match(app, /<ProfileIdentityRecoveryBridge \/>/);
  assert.match(profileRecovery, /public_profile\/main/);
  assert.match(profileRecovery, /publicIdentity\.name \|\|/);
  assert.match(profileRecovery, /userIdentity\.name \|\|/);
  assert.match(profileRecovery, /updateProfile\(user/);
  assert.match(profileRecovery, /\{ merge: true \}/);
});

test('profile recovery only restores public identity fields and does not become an authorization layer', async () => {
  const { profileRecovery } = await readSources();

  assert.match(profileRecovery, /name: publicIdentity\.name/);
  assert.match(profileRecovery, /photoUrl: publicIdentity\.photoUrl/);
  assert.doesNotMatch(profileRecovery, /products\.write|store\.update|inventory\.write/);
  assert.doesNotMatch(profileRecovery, /walletBalance|transactionPin|kycCpf|kycCnpj/);
  assert.doesNotMatch(profileRecovery, /deleteDoc\(|updateDoc\(/);
});
