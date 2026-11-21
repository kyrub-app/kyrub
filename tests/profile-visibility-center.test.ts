import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');
const app = read('src/LegacyApp.tsx');
const center = read('src/components/modals/UserProfileModal.tsx');
const unified = read('src/components/ProfileVerificationBridge.tsx');
const identity = read('src/components/ProfilePublicIdentityEditor.tsx');
const social = read('src/components/ProfileSocialHubNative.tsx');
const rules = read('firestore.rules');

test('Central Pessoal opens one React-owned editor, not nested settings modals', () => {
  const main = center.slice(center.indexOf('export const UserProfileModal'));
  assert.match(main, /id="personal-profile-settings-trigger"/);
  assert.match(main, /aria-label="Editar perfil"/);
  assert.match(main, /<Settings className="h-4 w-4"/);
  assert.match(main, /className="relative h-20 w-20 shrink-0 sm:h-24 sm:w-24"/);
  assert.match(main, /className="absolute -bottom-3 -right-3 z-10/);
  assert.doesNotMatch(main, />\s*Editar perfil\s*</);
  assert.doesNotMatch(main, /<h3[^>]*>Meu perfil<\/h3>/);
  assert.doesNotMatch(main, />\s*Conta e segurança\s*</);
  assert.doesNotMatch(main, /ProfileSettingsPanel|kyrub:open-profile-settings/);
  assert.match(main, /window\.dispatchEvent\(new Event\('kyrub:open-unified-profile-editor'\)\)/);
  assert.match(unified, /window\.addEventListener\('kyrub:open-unified-profile-editor'/);
  assert.match(unified, /<ProfilePublicIdentityEditor user=\{user\}/);
  assert.doesNotMatch(unified, /profile-verification-trigger|MutationObserver/);
  assert.match(social, /const LEGACY_PROFILE_EDITOR_RETIRED = true/);
  assert.match(social, /!LEGACY_PROFILE_EDITOR_RETIRED && editOpen/);
});

test('one editor retains public identity, secure documents, work approval and PIN', () => {
  assert.match(identity, /Salvar perfil/);
  assert.match(identity, /updateProfile\(user/);
  assert.match(identity, /profile-images\/' \+ user\.uid/);
  assert.match(identity, /public_profile', 'main'/);
  assert.match(unified, /'perfil', label: 'Perfil'/);
  for (const tab of ["'conta'", "'dados'", "'seguranca'", "'documentos'", "'validacao'"]) {
    assert.ok(unified.includes(tab), 'Missing tab: ' + tab);
  }
  assert.match(unified, /api\/security\/pin/);
  assert.match(unified, /identity-verification\/' \+ user\.uid|identity-verification\/\$\{user\.uid\}/);
  assert.match(unified, /workEligibility\(record, action\)/);
  assert.match(unified, /Central de Planos/);
  assert.match(unified, /kyrub:unified-profile-editor-closed/);
  assert.match(app, /window\.addEventListener\('kyrub:unified-profile-editor-closed'/);
});

test('Central owns the only visibility control with a real cloud write', () => {
  const main = center.slice(center.indexOf('export const UserProfileModal'));
  assert.match(main, /id="personal-profile-visibility"/);
  assert.match(main, /aria-pressed=\{isProfileVisible\}/);
  assert.match(main, /onClick=\{\(\) => void toggleProfileVisibility\(\)\}/);
  assert.match(main, /disabled=\{!profileVisibilityReady \|\| visibilityBusy\}/);
  assert.match(main, /Visível na Praça/);
  assert.match(main, /Perfil reservado/);
  assert.match(main, /Salvando…/);
  assert.doesNotMatch(main, /<Toggle|<h3[^>]*>Visibilidade do perfil<\/h3>/);
  assert.match(main, /updateDoc\(doc\(db, 'users', user\.uid\), \{/);
  assert.match(main, /isProfileVisible: nextVisibility,/);
  assert.match(main, /setIsProfileVisible\(nextVisibility\)/);
  assert.match(main, /Não foi possível salvar a visibilidade/);
  assert.match(main, /Não modifica publicações nem comunidades/);
  assert.doesNotMatch(unified, /setProfileVisible|isProfileVisible: profileVisible/);
});

test('login preserves persisted visibility across sessions', () => {
  assert.match(app, /typeof storedUser\?\.isProfileVisible === 'boolean'/);
  assert.match(app, /storedUser\.isProfileVisible\s*:\s*true/);
  assert.match(app, /isProfileVisible: savedVisibility/);
  assert.match(app, /setIsProfileVisible\(savedVisibility\)/);
  assert.match(app, /profileVisibilityReady=\{profileVisibilityReadyFor === authenticatedUserId\}/);
  assert.doesNotMatch(app, /isProfileVisible: true,\s*updatedAt: serverTimestamp\(\)/);
  assert.match(rules, /'isProfileVisible'/);
});
