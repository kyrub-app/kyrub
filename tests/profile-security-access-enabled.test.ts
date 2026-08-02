import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const flagsSource = readFileSync('src/utils/featureFlags.ts', 'utf8');
const appSource = readFileSync('src/App.tsx', 'utf8');
const recoveredActionsSource = readFileSync(
  'src/components/ProfileRecoveredActionsBridge.tsx',
  'utf8'
);
const secureSectionsSource = readFileSync(
  'src/components/ProfileSecureEditorSections.tsx',
  'utf8'
);
const passkeyControlsSource = readFileSync(
  'src/components/ProfilePasskeyControls.tsx',
  'utf8'
);

test('secure profile tabs are available by default outside development', () => {
  assert.match(flagsSource, /identityVerificationSetting/);
  assert.match(flagsSource, /!explicitlyDisabled\(identityVerificationSetting\)/);
  assert.match(appSource, /<ProfileVerificationBridge \/>/);
  assert.match(appSource, /<ProfilePasskeyBridge \/>/);
});

test('modern edit profile owns Docs, Bio and Face navigation', () => {
  assert.match(recoveredActionsSource, /label: 'Docs'/);
  assert.match(recoveredActionsSource, /label: 'Bio'/);
  assert.match(recoveredActionsSource, /label: 'Face'/);
  assert.match(recoveredActionsSource, /setActiveEditSection\(shortcut\.id\)/);
  assert.match(recoveredActionsSource, /<ProfileSecureEditorSections/);
  assert.match(recoveredActionsSource, /data-profile-edit-security-content/);
  assert.doesNotMatch(recoveredActionsSource, /IDENTITY_VERIFICATION_OPEN_EVENT/);
  assert.doesNotMatch(recoveredActionsSource, /closeEditButton\?\.click/);
});

test('secure sections render real document, passkey and assisted face controls', () => {
  assert.match(secureSectionsSource, /IDENTITY_VERIFICATION_COLLECTION/);
  assert.match(secureSectionsSource, /identity-verification\/\$\{user\.uid\}/);
  assert.match(secureSectionsSource, /Anexar documento/);
  assert.match(secureSectionsSource, /<ProfilePasskeyControls user=\{user\}/);
  assert.match(secureSectionsSource, /Validação facial/);
  assert.match(secureSectionsSource, /análise humana/);
  assert.match(passkeyControlsSource, /navigator\.credentials\.create/);
  assert.match(passkeyControlsSource, /navigator\.credentials\.get/);
  assert.doesNotMatch(passkeyControlsSource, /getUserMedia/);
});
