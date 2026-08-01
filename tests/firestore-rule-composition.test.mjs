import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DELIVERY_SECTION_HEADER,
  FREELANCE_SECTION_HEADER,
  hardenKyrubDeliveryRules,
  hardenKyrubFreelanceRules,
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

const legacyFreelanceRules = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
${FREELANCE_SECTION_HEADER}
    match /vagas/{vagaId} {
      allow read: if isSignedIn();
      allow create, update, delete: if isAdmin() || hasRole(['lojista', 'prestador']);
    }
    match /candidaturas/{candiId} {
      allow read: if isSignedIn();
      allow create: if isSignedIn() && request.resource.data.userId == request.auth.uid;
      allow update, delete: if isSignedIn();
    }

    match /artifacts/{userId}/{document=**} {
      allow read: if request.auth.uid == userId;
    }
  }
}`;

test('replaces legacy delivery rules with the server-authoritative block', () => {
  const result = hardenKyrubDeliveryRules(legacyRules);

  assert.match(result, /allow create, update, delete: if false;/);
  assert.doesNotMatch(result, /allow create: if isSignedIn\(\);/);
  assert.match(result, /Firebase Admin SDK/);
});

test('composition is idempotent when the secure delivery block already exists', () => {
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

test('freelance applications and vacancy creation require approved profiles', () => {
  const result = hardenKyrubFreelanceRules(legacyFreelanceRules);

  assert.match(result, /hasApprovedIdentityProfile\('requester'\)/);
  assert.match(result, /hasApprovedIdentityProfile\('freelancer'\)/);
  assert.match(result, /existing\(\)\.userId == request\.auth\.uid/);
  assert.doesNotMatch(result, /allow update, delete: if isSignedIn\(\);/);
});

test('freelance composition is idempotent', () => {
  const secured = hardenKyrubFreelanceRules(legacyFreelanceRules);
  assert.equal(hardenKyrubFreelanceRules(secured), secured);
});
