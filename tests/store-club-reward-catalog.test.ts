import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertGlobalRewardCatalogItem,
  assertStoreChallenge,
  assertStoreClub,
  storePointsCanConvertToKCoins,
} from '../shared/storeClub';

test('global reward catalog requires positive K-Coin cost and store funding provenance when applicable', () => {
  assert.throws(
    () => assertGlobalRewardCatalogItem({ id: 'r1', title: 'Reward', description: '', costKCoins: 0, benefitType: 'voucher', fundingType: 'kyrub', status: 'draft' }),
    /REWARD_KCOIN_COST_INVALID/
  );
  assert.throws(
    () => assertGlobalRewardCatalogItem({ id: 'r2', title: 'Reward', description: '', costKCoins: 100, benefitType: 'voucher', fundingType: 'store', status: 'draft' }),
    /REWARD_STORE_REQUIRED/
  );
});

test('store club requires explicit store scope and versioned rules', () => {
  assert.throws(
    () => assertStoreClub({ storeId: '', status: 'draft', loyaltyUnitName: 'Pontos', memberCount: 0, activeCampaignIds: [], benefitIds: [], rulesVersion: '1' }),
    /STORE_CLUB_STORE_REQUIRED/
  );
});

test('store challenge rewards stay inside store economy', () => {
  const challenge = assertStoreChallenge({
    id: 'c1', storeId: 'store-1', title: 'Volte esta semana', description: '', validationMode: 'deterministic',
    reward: { type: 'store_points', amount: 10 }, status: 'draft'
  });
  assert.equal(challenge.reward.type, 'store_points');
  assert.equal(storePointsCanConvertToKCoins(), false);
});
