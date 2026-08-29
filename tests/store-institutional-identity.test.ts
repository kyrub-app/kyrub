import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  buildStoreInstitutionalPrincipalId,
  buildStoreInstitutionalRepresentation,
  canRepresentStoreWithCapability,
  projectStoreInstitutionalIdentity,
  storeInstitutionalCapabilitiesForRole,
} from '../shared/storeInstitutionalIdentity';
import { projectStoreIdentityFromStore } from '../src/utils/storeInstitutionalIdentity';

describe('store institutional identity', () => {
  test('store has a deterministic principal distinct from the human UID', () => {
    assert.equal(buildStoreInstitutionalPrincipalId('owner-123'), 'store:owner-123');
    const identity = projectStoreInstitutionalIdentity({
      storeId: 'owner-123',
      name: 'Minha Loja',
      slug: 'minha-loja',
      logo: 'https://example.test/logo.png',
      status: 'open',
    });
    const representation = buildStoreInstitutionalRepresentation({
      identity,
      authenticatedUserId: 'owner-123',
      role: 'owner',
    });

    assert.notEqual(representation.identity.principalId, representation.authenticatedUserId);
    assert.equal(representation.identity.principalId, 'store:owner-123');
    assert.equal(representation.authenticatedUserId, 'owner-123');
  });

  test('institutional identity projects the same canonical store fields', () => {
    const identity = projectStoreIdentityFromStore({
      id: 'store-1',
      name: 'City Chopperia',
      slug: 'city-chopperia',
      description: 'Descrição comercial',
      logo: 'logo.png',
      banner: 'banner.png',
      primaryColor: '#123456',
      keywords: ['burger', 'chopp'],
      address: 'Rua A, 10',
      contact: '(11) 99999-9999',
      status: 'open',
    });

    assert.equal(identity.storeId, 'store-1');
    assert.equal(identity.displayName, 'City Chopperia');
    assert.equal(identity.avatarUrl, 'logo.png');
    assert.equal(identity.bannerUrl, 'banner.png');
    assert.equal(identity.description, 'Descrição comercial');
    assert.equal(identity.address, 'Rua A, 10');
    assert.equal(identity.contact, '(11) 99999-9999');
    assert.deepEqual(identity.keywords, ['burger', 'chopp']);
  });

  test('roles prepare representation without pretending team membership already exists', () => {
    assert.deepEqual(storeInstitutionalCapabilitiesForRole('owner'), [
      'identity_manage',
      'team_manage',
      'relationship_read',
      'conversation_act',
      'notification_act',
    ]);
    assert.equal(canRepresentStoreWithCapability('manager', 'conversation_act'), true);
    assert.equal(canRepresentStoreWithCapability('manager', 'team_manage'), false);
    assert.equal(canRepresentStoreWithCapability('attendant', 'conversation_act'), true);
    assert.equal(canRepresentStoreWithCapability('attendant', 'identity_manage'), false);
    assert.equal(canRepresentStoreWithCapability('attendant', 'notification_act'), false);
  });

  test('V1 resolves representation from the existing private store document and owner token', () => {
    const service = readFileSync(
      'server/store/storeInstitutionalIdentityService.ts',
      'utf8'
    );
    const router = readFileSync(
      'server/store/storeInstitutionalIdentityRouter.ts',
      'utf8'
    );

    assert.match(service, /getPrimaryUserStoreDocumentPath\(storeId\)/);
    assert.match(service, /authenticatedUserId !== storeId/);
    assert.match(service, /clean\(data\.ownerId\) !== authenticatedUserId/);
    assert.match(service, /role: 'owner'/);
    assert.match(router, /verifyFirebaseIdToken\(token\)/);
    assert.match(router, /authenticatedUserId: identity\.uid/);
    assert.doesNotMatch(router, /request\.body/);
    assert.doesNotMatch(service, /storeIdentit(?:y|ies)/i);
  });

  test('client representation uses the human session without a second login', () => {
    const client = readFileSync('src/utils/storeInstitutionalIdentity.ts', 'utf8');
    const service = readFileSync(
      'server/store/storeInstitutionalIdentityService.ts',
      'utf8'
    );

    assert.match(client, /user\.getIdToken\(\)/);
    assert.match(client, /\/api\/store-identity\?storeId=/);
    assert.match(client, /user\.uid !== storeId/);
    assert.doesNotMatch(client, /signInWith|createUserWith|createCustomToken/);
    assert.doesNotMatch(service, /createUser|createCustomToken/);
  });

  test('management UI makes the human/store distinction explicit and is mounted globally', () => {
    const panel = readFileSync(
      'src/components/store/StoreInstitutionalIdentityPanel.tsx',
      'utf8'
    );
    const bridge = readFileSync(
      'src/components/store/StoreInstitutionalIdentityBridge.tsx',
      'utf8'
    );
    const app = readFileSync('src/App.tsx', 'utf8');

    assert.match(panel, /Você continua autenticado como pessoa/);
    assert.match(panel, /Principal institucional/);
    assert.match(panel, /Responder como loja/);
    assert.match(panel, /sem criar\s+uma conta de login separada para a loja/);
    assert.match(bridge, /erp-gerencial-tab/);
    assert.match(bridge, /kyrub-store-institutional-identity-host/);
    assert.match(app, /<StoreInstitutionalIdentityBridge \/>/);
  });
});
