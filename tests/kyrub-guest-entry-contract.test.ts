import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { projectPublicDeliveryOpportunity } from '../shared/publicDeliveryDiscovery';

const app = readFileSync('src/App.tsx', 'utf8');
const guest = readFileSync('src/components/KyrubGuestWorkspace.tsx', 'utf8');
const renda = readFileSync('src/components/tabs/RendaTab.tsx', 'utf8');
const rules = readFileSync('firestore.rules', 'utf8');
const api = readFileSync('api/health.ts', 'utf8');
const vercel = readFileSync('vercel.json', 'utf8');

test('root selects the real Kyrub workspace for signed and guest visitors, landing retained explicitly', () => {
  assert.match(app, /return <KyrubMainEntry \/>/);
  assert.match(app, /return currentUser\s*\?\s*<AuthenticatedKyrubApp operational=\{false\} \/>\s*:\s*<KyrubGuestWorkspace \/>/);
  assert.match(app, /entry === 'welcome'/);
  assert.match(app, /return <KyrubRendaEntryApp \/>/);
  assert.doesNotMatch(app, /entry === null \|\| entry === 'renda'/);
});

test('guest can open real Renda cards without creating a store, booking delivery or granting rewards', () => {
  assert.match(guest, /<RendaTab[\s\S]*guestReadOnly/);
  assert.match(guest, /setShowDeliveryModal=\{\(\) => requestLogin/);
  assert.match(guest, /onGuestBrowseDeliveries=\{\(\) => openPanel\('deliveries'\)\}/);
  assert.match(renda, /if \(guestReadOnly\) \{\s*onGuestLoginRequired/);
  assert.match(guest, /Aceitar entrega/);
  assert.match(guest, /requestLogin\('aceitar uma entrega'\)/);
  assert.doesNotMatch(guest, /updateDoc|setDoc|deleteDoc|runTransaction|acceptDeliveryOpportunity/);
});

test('public deliveries expose no private details even if present in Firestore source', () => {
  const full = {
    source: 'kyrub-order', status: 'available', acceptedBy: '',
    from: 'Rua Privada 123', to: 'Rua Secreta 456',
    buyerId: 'buyer_private', buyerEmail: 'private@example.test',
    customerPhone: '1111111111', payment: 19.95,
    preciseGps: { latitude: -23, longitude: -46 },
  };
  const projected = projectPublicDeliveryOpportunity('order_safe123', full);
  assert.deepEqual(projected, {
    id: 'order_safe123', label: 'Entrega Kyrub disponível',
  });
  const serialized = JSON.stringify(projected);
  for (const secret of ['Rua Privada', 'Rua Secreta', 'buyer_private', 'private@example.test', '19.95', 'latitude']) {
    assert.equal(serialized.includes(secret), false);
  }
  assert.equal(projectPublicDeliveryOpportunity('manual', { ...full, source: 'manual' }), null);
  assert.equal(projectPublicDeliveryOpportunity('already', { ...full, status: 'accepted' }), null);
  assert.equal(projectPublicDeliveryOpportunity('assigned', { ...full, acceptedBy: 'uid123' }), null);
  assert.equal(projectPublicDeliveryOpportunity('bad/path', full), null);
});

test('public read uses server-side API without weakening private Firestore rules', () => {
  assert.match(api, /transport === 'public-delivery-discovery'/);
  assert.match(vercel, /"source": "\/api\/delivery-opportunities\/public"/);
  assert.match(rules, /match \/hub\/renda\/deliveries\/\{deliveryId\}/);
  assert.match(rules, /allow read: if isSignedIn\(\);/);
});
