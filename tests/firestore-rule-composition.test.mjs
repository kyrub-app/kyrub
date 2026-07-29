import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DELIVERY_SECTION_HEADER,
  hardenKyrubDeliveryRules,
} from '../scripts/firestore-rule-composition.mjs';

const legacyRules = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
${DELIVERY_SECTION_HEADER}
    match /hub/renda/deliveries/{deliveryId} {
      allow read: if isSignedIn();
      allow create: if isSignedIn();
      allow update, delete: if isSignedIn();
    }

    // --- Guia Renda: Vagas de Freela (Otimizado com Custom Claims) ---
    match /vagas/{vagaId} {
      allow read: if isSignedIn();
    }
  }
}`;

test('replaces legacy delivery rules with the server-authoritative block', () => {
  const result = hardenKyrubDeliveryRules(legacyRules);

  assert.match(result, /allow create, update, delete: if false;/);
  assert.doesNotMatch(result, /allow create: if isSignedIn\(\);/);
  assert.match(result, /Firebase Admin SDK/);
});

test('composition is idempotent when the secure block already exists', () => {
  const secured = hardenKyrubDeliveryRules(legacyRules);

  assert.equal(hardenKyrubDeliveryRules(secured), secured);
});

test('composition accepts Windows CRLF checkouts', () => {
  const windowsRules = legacyRules.replaceAll('\n', '\r\n');
  const result = hardenKyrubDeliveryRules(windowsRules);

  assert.match(result, /allow create, update, delete: if false;/);
  assert.ok(result.includes('\r\n'));
  assert.doesNotMatch(result, /allow create: if isSignedIn\(\);/);
});

test('composition fails clearly when the delivery section is absent', () => {
  assert.throws(
    () => hardenKyrubDeliveryRules('rules_version = \'2\';'),
    /Kyrub delivery rules section was not found/
  );
});
