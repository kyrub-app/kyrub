import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const flagsSource = readFileSync('src/utils/featureFlags.ts', 'utf8');
const appSource = readFileSync('src/App.tsx', 'utf8');
const recoveredActionsSource = readFileSync(
  'src/components/ProfileRecoveredActionsBridge.tsx',
  'utf8'
);

test('secure profile tabs are available by default outside development', () => {
  assert.match(flagsSource, /identityVerificationSetting/);
  assert.match(flagsSource, /!explicitlyDisabled\(identityVerificationSetting\)/);
  assert.match(appSource, /<ProfileVerificationBridge \/>/);
  assert.match(appSource, /<ProfilePasskeyBridge \/>/);
});

test('edit profile exposes document, biometric and facial validation shortcuts', () => {
  assert.match(recoveredActionsSource, /label: 'Documentos'/);
  assert.match(recoveredActionsSource, /label: 'Biometria'/);
  assert.match(recoveredActionsSource, /label: 'Validação facial'/);
  assert.match(recoveredActionsSource, /IDENTITY_VERIFICATION_OPEN_EVENT/);
});
