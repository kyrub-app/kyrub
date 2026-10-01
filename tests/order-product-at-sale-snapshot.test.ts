import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  buildOrderProductAtSaleSnapshot,
  parseOrderProductAtSaleSnapshot,
} from '../shared/orderProductAtSaleSnapshot';

describe('order product at-sale snapshot', () => {
  test('freezes commercial evidence and margin target independently of later source changes', () => {
    const items = [{
      productId: 'produto_a',
      name: 'Produto A',
      quantity: 1,
      transferredQuantity: 0,
      lineId: 'line-a',
      price: 30,
      discountAmount: 5,
    }];
    const settings = {
      produto_a: {
        targetMarginPercent: 40,
        updatedAt: '2026-09-30T20:00:00.000Z',
      },
    };

    const snapshot = buildOrderProductAtSaleSnapshot({
      orderItems: items,
      rawPricingSettings: settings,
      capturedAt: '2026-09-30T21:00:00.000Z',
      capturedForStatus: 'accepted',
    });

    items[0].price = 99;
    items[0].discountAmount = 0;
    settings.produto_a.targetMarginPercent = 70;

    assert.equal(snapshot.schemaVersion, 1);
    assert.equal(snapshot.capturedForStatus, 'accepted');
    assert.equal(snapshot.commercialLines[0]?.merchandiseRevenueMinor, 2500);
    assert.equal(snapshot.marginTargets[0]?.targetMarginPercent, 40);
  });

  test('round-trips a valid frozen snapshot and fails closed for malformed evidence', () => {
    const snapshot = buildOrderProductAtSaleSnapshot({
      orderItems: [{
        productId: 'produto_a',
        name: 'Produto A',
        quantity: 2,
        price: 20,
        discountAmount: 0,
      }],
      rawPricingSettings: {},
      capturedAt: '2026-09-30T21:00:00.000Z',
      capturedForStatus: 'accepted',
    });

    assert.deepEqual(parseOrderProductAtSaleSnapshot(snapshot), snapshot);
    assert.deepEqual(snapshot.marginTargets, []);
    assert.equal(
      parseOrderProductAtSaleSnapshot({ ...snapshot, commercialLines: 'invalid' }),
      null
    );
  });

  test('status transition owns create-once capture and keeps sensitive target out of customer order patches', () => {
    const source = readFileSync('server/inventory/orderInventoryService.ts', 'utf8');
    assert.match(source, /orderProductProfitability/);
    assert.match(source, /buildOrderProductAtSaleSnapshot/);
    assert.match(source, /parseOrderProductAtSaleSnapshot/);
    assert.match(source, /currentStatus === 'pending'/);
    assert.match(source, /effectiveStatus !== 'rejected'/);
    assert.match(source, /effectiveStatus !== 'cancelled'/);
    assert.match(source, /transaction\.set\(atSaleReference, \{ atSaleSnapshot \}/);
    assert.doesNotMatch(
      source,
      /transaction\.set\(\s*orderReference,[\s\S]{0,500}atSaleSnapshot/
    );
  });

  test('profitability reconciliation prefers frozen evidence while preserving legacy fallback', () => {
    const source = readFileSync('server/payments/storeProductProfitabilityService.ts', 'utf8');
    assert.match(source, /parseOrderProductAtSaleSnapshot/);
    assert.match(source, /rawAtSaleSnapshot !== undefined/);
    assert.match(source, /!atSaleSnapshot && commercialLines\.length === 0/);
    assert.match(source, /!atSaleSnapshot &&[\s\S]*marginTargets\.length === 0/);
    assert.match(source, /historicalTargets/);
    assert.match(source, /\.\.\.\(atSaleSnapshot \? \{ atSaleSnapshot \} : \{\}\)/);
  });
});
