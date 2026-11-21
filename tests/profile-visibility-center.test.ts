import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');
const app = read('src/LegacyApp.tsx');
const center = read('src/components/modals/UserProfileModal.tsx');
const editor = read('src/components/ProfileSocialHubNative.tsx');
const rules = read('firestore.rules');

test('one Editar perfil in the Central opens the real existing identity editor', () => {
  const main = center.slice(center.indexOf('export const UserProfileModal'));
  assert.match(main, /> Editar perfil/);
  assert.equal((main.match(/> Editar perfil/g) ?? []).length, 1);
  assert.doesNotMatch(main, />\s*Conta e segurança\s*</);
  assert.match(main, /window\.dispatchEvent\(new Event\('kyrub:open-profile-editor'\)\)/);
  assert.match(editor, /window\.addEventListener\('kyrub:open-profile-editor'/);
  assert.match(editor, /onSubmit=\{saveProfile\}/);
  assert.match(editor, /uploadProfilePhoto/);
  assert.match(editor, /restoreGooglePhoto/);
});

test('structured account settings remain available from within the single profile editor', () => {
  assert.match(editor, /aria-label="Abrir dados e configurações do perfil"/);
  assert.match(editor, /window\.dispatchEvent\(new Event\('kyrub:open-profile-settings'\)\)/);
  assert.match(center, /window\.addEventListener\('kyrub:open-profile-settings'/);
  assert.match(center, /setIsSettingsOpen\(true\)/);
  for (const tab of ["label: 'Conta'", "label: 'Dados'", "label: 'Segurança'", "label: 'Verificação'"]) {
    assert.ok(center.includes(tab), 'Editor missing tab: ' + tab);
  }
  assert.match(editor, /Perfil e identidade/);
  assert.match(editor, /Salvar perfil público/);
});

test('Central owns a single visibility control with a real cloud write and failure handling', () => {
  const settings = center.slice(center.indexOf('const ProfileSettingsPanel'), center.indexOf('export const UserProfileModal'));
  const main = center.slice(center.indexOf('export const UserProfileModal'));
  assert.doesNotMatch(settings, /label="Alternar visibilidade do perfil"/);
  assert.match(main, /id="personal-profile-visibility"/);
  assert.match(main, /label="Alternar visibilidade do perfil"/);
  assert.match(main, /disabled=\{!profileVisibilityReady \|\| visibilityBusy\}/);
  assert.match(main, /updateDoc\(doc\(db, 'users', user\.uid\), \{/);
  assert.match(main, /isProfileVisible: nextVisibility,/);
  assert.match(main, /updatedAt: serverTimestamp\(\)/);
  assert.match(main, /setIsProfileVisible\(nextVisibility\)/);
  assert.match(main, /Não foi possível salvar a visibilidade/);
  assert.match(main, /Isso não altera publicações ou comunidades/);
  assert.doesNotMatch(settings, /isProfileVisible: true|isProfileVisible: false|isProfileVisible: nextVisibility/);
});

test('login reads persisted visibility rather than making hidden profiles public again', () => {
  assert.match(app, /typeof storedUser\?\.isProfileVisible === 'boolean'/);
  assert.match(app, /storedUser\.isProfileVisible\s*:\s*true/);
  assert.match(app, /isProfileVisible: savedVisibility/);
  assert.match(app, /setIsProfileVisible\(savedVisibility\)/);
  assert.match(app, /setProfileVisibilityReadyFor\(user\.uid\)/);
  assert.match(app, /profileVisibilityReady=\{profileVisibilityReadyFor === authenticatedUserId\}/);
  assert.doesNotMatch(app, /isProfileVisible: true,\s*updatedAt: serverTimestamp\(\)/);
  assert.match(rules, /'isProfileVisible'/);
});
