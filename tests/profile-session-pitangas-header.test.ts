import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const profile = readFileSync('src/components/ProfileSocialHubNative.tsx', 'utf8');
const legacy = readFileSync('src/LegacyApp.tsx', 'utf8');
const guest = readFileSync('src/components/KyrubGuestWorkspace.tsx', 'utf8');
const rewards = readFileSync('src/components/tabs/KyrubTab.tsx', 'utf8');
const account = readFileSync('src/components/tabs/PitangaAccount.tsx', 'utf8');
const entry = readFileSync('src/App.tsx', 'utf8');

test('the marked identity card exposes a single real sign-out action', () => {
  assert.match(profile, /import \{ onAuthStateChanged, signOut, updateProfile, type User \} from 'firebase\/auth'/);
  assert.match(profile, /id="profile-session-logout"/);
  assert.match(profile, /onClick=\{\(\) => void handleProfileSignOut\(\)\}/);
  assert.match(profile, /disabled=\{sessionBusy\}/);
  assert.match(profile, /await signOut\(auth\)/);
  assert.match(profile, /setEditOpen\(false\);\s*setOpen\(false\)/);
  assert.match(profile, /Não foi possível sair da conta/);
});

test('after exit, the existing guest account route offers select-account Google login', () => {
  assert.match(entry, /currentUser\s*\? <AuthenticatedKyrubApp operational=\{false\} \/>\s*:\s*<KyrubGuestWorkspace \/>/);
  assert.match(guest, /onClick=\{\(\) => requestLogin\('acessar seu perfil'\)\}/);
  assert.match(guest, /loginReason === 'acessar seu perfil' \? 'Perfil e identidade'/);
  assert.match(guest, /Entrar com Google/);
  assert.match(guest, /signInWithPopup\(auth, provider\)/);
  assert.match(guest, /prompt: 'select_account'/);
});

test('the Pitangas icon navigates to the current account view, not a duplicate wallet', () => {
  assert.match(legacy, /id="header-pitangas-trigger"/);
  assert.match(legacy, /aria-label="Abrir Pitangas e XP"/);
  assert.match(legacy, /<Cherry className="w-4 h-4"/);
  assert.match(legacy, /setSocialSubTab\('lojas'\);\s*setOfertasFilter\('cliente'\);\s*setActiveTab\('kyrub'\)/);
  assert.match(rewards, /props\.socialSubTab === 'lojas' && props\.ofertasFilter === 'cliente'/);
  assert.match(rewards, /<PitangaAccount key=/);
  assert.match(account, /fetch\('\/api\/pitangas'/);
  assert.match(guest, /id="header-pitangas-trigger"/);
  assert.match(guest, /requestLogin\('consultar suas Pitangas e XP'\)/);
});
