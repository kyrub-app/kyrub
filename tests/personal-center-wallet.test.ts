import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');
const app = read('src/LegacyApp.tsx');
const navigation = read('src/components/WorkspaceTopNavigation.tsx');
const profile = read('src/components/modals/UserProfileModal.tsx');
const socialHub = read('src/components/ProfileSocialHubNative.tsx');
const unifiedEditor = read('src/components/ProfileVerificationBridge.tsx');
const wallet = read('src/components/modals/WalletModal.tsx');
const planner = read('src/components/PersonalFinancePlanner.tsx');
const pitangas = read('src/components/tabs/PitangaAccount.tsx');
const square = read('src/components/tabs/KyrubTab.tsx');

describe('Carteira e Central Pessoal', () => {
  test('header maintains identity, AI, tasks and notifications while moving Conectados/Salvos', () => {
    assert.match(app, /<WorkspaceTopNavigation/);
    assert.match(navigation, /id="header-user-profile-trigger"/);
    assert.match(navigation, /id="header-kyrubia-trigger"/);
    assert.match(navigation, /id="header-tasks-trigger"/);
    assert.match(navigation, /id="header-connected-trigger"/);
    assert.match(navigation, /id="header-saved-trigger"/);
    assert.match(app, /new Event\('kyrub:open-connections'\)/);
    assert.doesNotMatch(app, /id="header-pitangas-trigger"/);
    assert.doesNotMatch(app, /id="header-wallet-balance"/);
    assert.match(socialHub, /window\.addEventListener\('kyrub:open-connections'/);
    assert.doesNotMatch(socialHub, /stopImmediatePropagation/);
  });

  test('profile icon reaches private central, preserving original edit flow and account settings', () => {
    assert.match(app, /setProfileOpenSaved\(false\); setShowUserProfileModal\(true\)/);
    assert.match(profile, /Central Pessoal/);
    assert.match(profile, /profile-personal-center/);
    assert.match(profile, /id="personal-profile-settings-trigger"/);
    assert.match(profile, /aria-label="Editar perfil"/);
    assert.match(profile, /window\.dispatchEvent\(new Event\('kyrub:open-unified-profile-editor'\)\)/);
    assert.match(unifiedEditor, /window\.addEventListener\('kyrub:open-unified-profile-editor'/);
    assert.doesNotMatch(profile, />\s*Conta e segurança\s*</);
    assert.match(profile, /id="personal-profile-visibility"/);
    assert.doesNotMatch(profile, /ProfileSettingsPanel|kyrub:open-profile-settings/);
    assert.match(unifiedEditor, /<ProfilePublicIdentityEditor user=\{user\}/);
    assert.match(app, /walletHistory=\{walletHistory\}/);
  });

  test('guest login and authenticated logout share the scrolling brand position', () => {
    const guest = read('src/components/KyrubGuestWorkspace.tsx');
    assert.match(app, /id="kyrub-workspace-signout"/);
    assert.match(app, /onClick=\{\(\) => void handleLogout\(\)\}/);
    assert.match(app, /disabled=\{isSigningOut\}/);
    assert.match(app, /await signOut\(auth\)/);
    assert.match(app, /retainedWorkspaceTabByUser\.delete\(signingOutUid\)/);
    assert.match(guest, /id="kyrub-guest-signin"/);
    assert.match(guest, /requestLogin\('acessar sua conta'\)/);
    assert.match(guest, /signInWithPopup\(auth, provider\)/);
    assert.match(app, /id="kyrub-workspace-brand" className="flex min-h-10/);
    assert.match(guest, /id="kyrub-guest-brand" className="flex min-h-10/);
    assert.doesNotMatch(profile, /personal-profile-auth-trigger|onAuthAction|isAuthBusy/);
    assert.match(profile, /id="personal-profile-settings-trigger"/);
  });

  test('Salvos opens existing private multi-source library from header', () => {
    assert.match(app, /setProfileOpenSaved\(true\); setShowUserProfileModal\(true\)/);
    assert.match(app, /openSavedInitially=\{profileOpenSaved\}/);
    assert.match(profile, /setIsSavedOpen\(openSavedInitially\)/);
    assert.match(profile, /subscribeSavedPublications/);
    assert.match(profile, /subscribeSelections/);
    assert.match(profile, /profile-saved-library/);
    assert.match(profile, /item\.sourceKind === 'community'/);
  });

  test('Central Pessoal preserves wallet areas and adds devices alongside achievements', () => {
    const cards = profile.slice(profile.indexOf('const financeCards = ['), profile.indexOf('] as const;', profile.indexOf('const financeCards = [')));
    const cardIds = [...cards.matchAll(/\{ id: '(\w+)'/g)].map(match => match[1]);
    assert.deepEqual(cardIds, ['movements', 'finance', 'xp', 'devices', 'challenges']);
    assert.doesNotMatch(cards, /id: 'pitangas'/);
    assert.match(profile, /card\.id === 'challenges' \? 'col-span-2'/);
    assert.match(profile, /<WalletMovementsPanel walletHistory=\{walletHistory\}/);
    assert.match(profile, /<PersonalFinancePlanner userId=\{currentUserId\}/);
    assert.match(profile, /<PitangaAccount mode="xp"/);
    assert.doesNotMatch(profile, /<PitangaAccount mode="pitangas"/);
    assert.doesNotMatch(profile, /id: 'clubs'/);
    assert.match(square, /aria-label="Meus clubes"/);
    assert.doesNotMatch(square, /<PitangaAccount/);
  });

  test('manual planning does not simulate a bank account or modify other users or store ERP', () => {
    assert.match(planner, /kyrub_personal_budget_v1_\$\{userId\}/);
    assert.match(planner, /localStorage\.setItem/);
    assert.match(planner, /entry\.kind === 'fixed'/);
    assert.match(planner, /entry\.month <= month/);
    assert.match(planner, /Receitas planejadas/);
    assert.match(planner, /Despesas planejadas/);
    assert.match(planner, /sem sincronização entre dispositivos/);
    assert.match(planner, /MAX_ITEMS = 200/);
    assert.match(planner, /crypto\.randomUUID\(\)/);
    assert.doesNotMatch(planner, /setDoc|deleteDoc|runTransaction|fetch\('/);
    assert.match(wallet, /WalletMovementsPanel/);
    assert.match(wallet, /não representam saldo/);
    assert.match(wallet, /Open Finance permanecerão indisponíveis/);
  });

  test('XP, real Pitangas balance, conversion and statement share the existing canonical account', () => {
    assert.match(pitangas, /mode = 'all'/);
    assert.match(pitangas, /mode === 'xp'/);
    assert.match(pitangas, /Pitangas disponíveis/);
    assert.match(pitangas, /account\.pitangas\.toLocaleString\('pt-BR'\)/);
    assert.match(pitangas, /fetch\('\/api\/pitangas'/);
    assert.match(pitangas, /requestId: requestId\.current/);
    assert.match(pitangas, /1\.000 Pitangas = 1 XP/);
    assert.match(pitangas, /<SemeaduraJourneyPanel/);
    assert.match(pitangas, /xp=\{mode === 'xp' \? \(account\?\.xp \?\? null\) : undefined\}/);
    assert.match(pitangas, /Extrato de recompensas/);
    assert.match(pitangas, /saldo de Pitangas creditadas não se confunde com sementes/);
    assert.doesNotMatch(pitangas, /{mode === 'xp'\s*\? \x60\$\{account\.xp/);
  });

  test('legacy personal feed is no longer rendered while Praça and communities remain intact', () => {
    assert.match(socialHub, /const PERSONAL_FEED_RETIRED = true/);
    assert.match(socialHub, /!PERSONAL_FEED_RETIRED && activeTab === 'publications'/);
    assert.match(socialHub, /As publicações são feitas na Praça e nas Comunidades/);
    assert.match(square, /<PublicSocialFeedPanel/);
    assert.doesNotMatch(planner, /social_posts|community_posts/);
  });
});

test('personal receiving settings remain isolated, private and inside Movimentações',()=>{
 const settings=read('src/components/modals/PersonalPixSettings.tsx');
 assert.match(wallet,/personalFinanceCandidateEnabled\(\) && <PersonalPixSettings/);
 assert.match(settings,/import\.meta\.env\.DEV/);
 assert.match(settings,/VITE_KYRUB_PERSONAL_FINANCE_LOCAL_HOMOLOGATION/);
 assert.match(settings,/VITE_KYRUB_FIREBASE_EMULATOR_E2E/);
 assert.match(settings,/kyrub-security-test/);
 assert.match(settings,/onAuthStateChanged/);
 assert.match(settings,/expectedRevision:current\.revision/);
 assert.match(settings,/ownershipVerified===false/);
 assert.doesNotMatch(settings,/localStorage|sessionStorage|console\./);
});

test('CID import in Movimentações uses server candidates and separate confirmation',()=>{
 const settings=read('src/components/modals/PersonalPixSettings.tsx');
 assert.match(settings,/view=cid_candidates/);
 assert.match(settings,/validCandidates\(list\)/);
 assert.match(settings,/cidConfirmed/);
 assert.match(settings,/sourceVersion:candidate.sourceVersion/);
 assert.match(settings,/replaceExisting:current.status==='declared'/);
 assert.match(settings,/Utilizar chave Pix do meu CID/);
 assert.match(settings,/setCandidates\(\[\]\)/);
});
