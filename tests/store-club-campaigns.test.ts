import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertKyrubClubStoreBenefitOffer,
  assertStoreClubCampaignMetrics,
  assertStoreClubFundingPolicy,
} from '../shared/storeClubCampaigns';

test('store-funded campaigns cannot issue beyond store budget or redeem beyond issuance cap', () => {
  assert.throws(
    () => assertStoreClubFundingPolicy({ storeId: 's1', fundingSource: 'store', budgetUnits: 100, issuanceCap: 101, redemptionCap: 50, killSwitch: false }),
    /STORE_FUNDING_ISSUANCE_EXCEEDS_BUDGET/
  );
  assert.throws(
    () => assertStoreClubFundingPolicy({ storeId: 's1', fundingSource: 'store', budgetUnits: 100, issuanceCap: 80, redemptionCap: 81, killSwitch: false }),
    /STORE_FUNDING_REDEMPTION_EXCEEDS_ISSUANCE/
  );
});

test('store benefit offered to Kyrub Clube remains explicitly store-funded', () => {
  const offer = assertKyrubClubStoreBenefitOffer({
    id: 'offer-1', storeId: 's1', title: 'Voucher da Loja', kCoinCost: 500, benefitId: 'benefit-1', status: 'draft', fundedBy: 'store'
  });
  assert.equal(offer.fundedBy, 'store');
});

test('campaign dashboard metrics reject impossible conversion/redemption counts', () => {
  assert.throws(
    () => assertStoreClubCampaignMetrics({ campaignId: 'c1', storeId: 's1', budgetUnits: 1000, participants: 10, redemptions: 11, conversions: 5, attributedRevenueMinor: 10000 }),
    /STORE_CAMPAIGN_REDEMPTIONS_EXCEED_PARTICIPANTS/
  );
});
