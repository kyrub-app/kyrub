import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
      allow create, update, delete: if isAdmin() || hasRole(['owner', 'manager', 'staff']);
    }
    match /candidaturas/{candiId} {
      allow read: if isSignedIn();
      allow create: if isSignedIn() && request.resource.data.userId == request.auth.uid;
      allow update, delete: if isSignedIn();
    }

    match /artifacts { allow list: if isSignedIn(); }
    match /tenants { allow list: if isSignedIn(); }
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
  assert.match(result, /hasRole\(\['owner', 'manager', 'staff'\]\)/);
  assert.match(result, /existing\(\)\.userId == request\.auth\.uid/);
  assert.doesNotMatch(result, /allow update, delete: if isSignedIn\(\);/);
});

test('freelance composition is idempotent', () => {
  const secured = hardenKyrubFreelanceRules(legacyFreelanceRules);
  assert.equal(hardenKyrubFreelanceRules(secured), secured);
});

test('the composer inserts fragments through a callback so dollar anchors stay literal', () => {
  const composer = readFileSync('scripts/compose-firestore-rules.mjs', 'utf8');
  const verificationRules = readFileSync(
    'firestore.identity-verification.fragment.rules',
    'utf8'
  );

  assert.match(composer, /replace\(\s*marker,\s*\(\) =>/);
  assert.match(verificationRules, /matches\('\^\[0-9\]\{11\}\$'\)/);
  assert.doesNotMatch(composer, /replace\(\s*marker,\s*`\$\{composedFragment\}/);
});

test('omnichannel identity mappings are composed as server-authoritative private data', () => {
  const composer = readFileSync('scripts/compose-firestore-rules.mjs', 'utf8');
  const rules = readFileSync('firestore.omnichannel.fragment.rules', 'utf8');

  assert.match(composer, /firestore\.omnichannel\.fragment\.rules/);
  assert.match(
    rules,
    /match \/stores\/\{storeId\}\/externalIdentityMappings\/\{mappingId\}/
  );
  assert.match(rules, /allow get, list: if storeSecOwnerOrManager\(storeId\);/);
  assert.match(rules, /allow create, update, delete: if false;/);
  assert.match(rules, /match \/externalIdentityLookup\/\{lookupId\}/);
  assert.match(rules, /allow read, write: if false;/);
});
