import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  STORE_CAMPAIGN_SEGMENTS,
  matchesStoreCampaignSegment,
  normalizeStoreCampaignBody,
  normalizeStoreCampaignIdempotencyKey,
  normalizeStoreCampaignTitle,
  storeCampaignDeliveryPath,
  storeCampaignPath,
} from '../shared/storeCampaigns';
import type { StoreCrmCustomerSummary } from '../shared/storeCrm';

const customer = (overrides: Partial<StoreCrmCustomerSummary> = {}): StoreCrmCustomerSummary => ({
  customerId: 'customer-1',
  displayName: 'Cliente',
  photoUrl: '',
  confirmedPurchases: 4,
  confirmedSpentMinor: 12000,
  lastActivityAt: '2026-08-29T12:00:00.000Z',
  pointsBalance: 90,
  activeChallenges: 1,
  completedChallenges: 0,
  rewardRedemptions: 0,
  level: {
    key: 'recurring',
    label: 'Cliente recorrente',
    confirmedPurchases: 4,
    nextLabel: 'Cliente frequente',
    nextAtPurchases: 10,
    progressPercent: 14,
  },
  ...overrides,
});

describe('store CRM campaigns', () => {
  test('segments are derived only from canonical CRM facts', () => {
    const sample = customer();
    assert.equal(matchesStoreCampaignSegment(sample, 'all_customers'), true);
    assert.equal(matchesStoreCampaignSegment(sample, 'customers'), true);
    assert.equal(matchesStoreCampaignSegment(sample, 'recurring'), true);
    assert.equal(matchesStoreCampaignSegment(sample, 'frequent'), false);
    assert.equal(matchesStoreCampaignSegment(sample, 'loyal'), false);
    assert.equal(matchesStoreCampaignSegment(sample, 'points_positive'), true);
    assert.equal(matchesStoreCampaignSegment(sample, 'active_challenge'), true);
    assert.equal(STORE_CAMPAIGN_SEGMENTS.length, 7);
  });

  test('campaign content and idempotency keys are bounded', () => {
    assert.equal(normalizeStoreCampaignTitle(' Oferta '), 'Oferta');
    assert.equal(normalizeStoreCampaignBody(' Volte para conhecer as novidades. '), 'Volte para conhecer as novidades.');
    assert.equal(normalizeStoreCampaignIdempotencyKey('campaign_123'), 'campaign_123');
    assert.throws(() => normalizeStoreCampaignIdempotencyKey('key with spaces'));
  });

  test('campaign and delivery paths are tenant scoped and deterministic', () => {
    assert.equal(
      storeCampaignPath('store-1', 'campaign-1'),
      'stores/store-1/campaigns/campaign-1'
    );
    assert.equal(
      storeCampaignDeliveryPath('store-1', 'campaign-1', 'customer-1'),
      'stores/store-1/campaigns/campaign-1/deliveries/customer-1'
    );
  });

  test('server loads audience from canonical CRM and never accepts browser customer ids', () => {
    const service = readFileSync('server/campaigns/storeCampaignService.ts', 'utf8');
    const router = readFileSync('server/campaigns/storeCampaignRouter.ts', 'utf8');
    const client = readFileSync('src/utils/storeCampaigns.ts', 'utf8');

    assert.match(service, /loadStoreCrmSummary\(\{ storeId \}\)/);
    assert.match(service, /matchesStoreCampaignSegment\(customer, segment\)/);
    assert.doesNotMatch(router, /request\.body\?\.customerIds/);
    assert.doesNotMatch(client, /customerIds/);
  });

  test('campaign authority requires institutional notification capability and audits human actor', () => {
    const router = readFileSync('server/campaigns/storeCampaignRouter.ts', 'utf8');
    const service = readFileSync('server/campaigns/storeCampaignService.ts', 'utf8');
    assert.match(router, /verifyFirebaseIdToken\(token\)/);
    assert.match(router, /loadOwnerStoreInstitutionalRepresentation/);
    assert.match(router, /capabilities\.includes\('notification_act'\)/);
    assert.match(router, /actorPrincipalId: representation\.identity\.principalId/);
    assert.match(router, /actorUserId: representation\.authenticatedUserId/);
    assert.match(service, /actorUserId,/);
  });

  test('marketing consent is checked again inside send transaction before delivery', () => {
    const service = readFileSync('server/campaigns/storeCampaignService.ts', 'utf8');
    const transactionStart = service.indexOf('return adminDb.runTransaction');
    const transactionBlock = service.slice(transactionStart);

    assert.match(service, /const hasMarketingConsent =/);
    assert.match(service, /marketing\?\.enabled === true/);
    assert.match(transactionBlock, /transaction\.getAll\(\.\.\.preferenceRefs\)/);
    assert.match(transactionBlock, /hasMarketingConsent\(snapshot, customerId\)/);
    assert.match(transactionBlock, /skipped_no_marketing_consent/);
    assert.match(transactionBlock, /category: 'marketing'/);
  });

  test('campaign, audit deliveries and eligible notifications are committed together', () => {
    const service = readFileSync('server/campaigns/storeCampaignService.ts', 'utf8');
    const transactionStart = service.indexOf('return adminDb.runTransaction');
    const transactionBlock = service.slice(transactionStart);

    assert.match(transactionBlock, /transaction\.set\(campaignRef, campaign\)/);
    assert.match(transactionBlock, /userNotificationPath\(customer\.customerId, notification\.id\)/);
    assert.match(transactionBlock, /storeCampaignDeliveryPath\(storeId, id, customer\.customerId\)/);
  });

  test('idempotency returns duplicate only for the same request fingerprint', () => {
    const service = readFileSync('server/campaigns/storeCampaignService.ts', 'utf8');
    assert.match(service, /campaignIdFor\(storeId, idempotencyKey\)/);
    assert.match(service, /existing\.requestFingerprint !== requestFingerprint/);
    assert.match(service, /STORE_CAMPAIGN_IDEMPOTENCY_CONFLICT/);
    assert.match(service, /duplicate: true/);
  });

  test('campaigns communicate only and do not mint economic benefits', () => {
    const shared = readFileSync('shared/storeCampaigns.ts', 'utf8');
    const service = readFileSync('server/campaigns/storeCampaignService.ts', 'utf8');
    assert.doesNotMatch(shared, /discountValue|voucherCode|rewardPoints|kcoin/i);
    assert.doesNotMatch(service, /storePointLedger|rewardRedemptions|create.*promotion/i);
    assert.match(service, /kind: 'storefront'/);
  });

  test('CRM UI previews authoritative counts and sends criteria, not recipients', () => {
    const manager = readFileSync('src/components/store/StoreCampaignManager.tsx', 'utf8');
    const crmPanel = readFileSync('src/components/store/StoreCrmRelationshipPanel.tsx', 'utf8');
    assert.match(crmPanel, /<StoreCampaignManager storeId=\{storeId\} \/>/);
    assert.match(manager, /marketingEligibleCount/);
    assert.match(manager, /skippedNoMarketingConsentCount/);
    assert.match(manager, /previewStoreCampaign\(\{ storeId, segment \}\)/);
    assert.match(manager, /sendStoreCampaign\(\{/);
    assert.doesNotMatch(manager, /customerIds/);
  });

  test('direct Firestore campaign writes remain closed to browser clients', () => {
    const rules = readFileSync('firestore.rules', 'utf8');
    assert.doesNotMatch(rules, /match \/campaigns\//);
    assert.match(rules, /match \/\{document=\*\*\} \{\s*allow read, write: if false;/);
  });
});
