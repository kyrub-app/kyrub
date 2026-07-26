import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dangerZoneSource = readFileSync(
  'src/components/store/StoreResetDangerZone.tsx',
  'utf8'
);
const sharingPanelSource = readFileSync(
  'src/components/store/StoreSharingPanel.tsx',
  'utf8'
);
const sharingBridgeSource = readFileSync(
  'src/components/store/StoreSharingPortalBridge.tsx',
  'utf8'
);
const restartLandingSource = readFileSync(
  'src/components/store/StoreRestartLandingBridge.tsx',
  'utf8'
);
const resetSource = readFileSync('src/utils/storeReset.ts', 'utf8');
const appSource = readFileSync('src/App.tsx', 'utf8');

test('store profile exposes a clearly labeled danger zone', () => {
  assert.match(sharingPanelSource, /<StoreResetDangerZone/);
  assert.match(dangerZoneSource, /Zona de perigo/);
  assert.match(dangerZoneSource, /Excluir loja e recomeçar/);
  assert.match(dangerZoneSource, /id="delete-store-and-restart-button"/);
});

test('destructive action requires the store name and an acknowledgement', () => {
  assert.match(dangerZoneSource, /expectedConfirmation/);
  assert.match(dangerZoneSource, /confirmationMatches/);
  assert.match(dangerZoneSource, /acknowledged/);
  assert.match(dangerZoneSource, /store-reset-confirmation-input/);
  assert.match(dangerZoneSource, /store-reset-history-acknowledgement/);
  assert.match(dangerZoneSource, /confirm-delete-store-and-restart-button/);
});

test('reset pauses public copies and archives catalogs without deleting operational history', () => {
  assert.match(resetSource, /publicationStatus: 'paused'/);
  assert.match(resetSource, /publicProducts: \[\]/);
  assert.match(resetSource, /publicationStatus: 'archived'/);
  assert.match(resetSource, /persistPrivateUserStore\(user, restartedStore\)/);
  assert.match(resetSource, /preservedOperationalHistory: true/);
  assert.doesNotMatch(resetSource, /deleteDoc/);
  assert.match(dangerZoneSource, /Pedidos, pagamentos, caixa, colaboradores e registros de auditoria/);
});

test('restart clears device setup and reloads into the create-store card', () => {
  assert.match(resetSource, /clearLocalStoreSetup\(storage, user\.uid\)/);
  assert.match(sharingBridgeSource, /STORE_RESTART_SESSION_KEY/);
  assert.match(sharingBridgeSource, /window\.location\.assign\('\/'\)/);
  assert.match(restartLandingSource, /user-store-card/);
  assert.match(restartLandingSource, /rendaButton\.click\(\)/);
  assert.match(appSource, /<StoreRestartLandingBridge/);
});
