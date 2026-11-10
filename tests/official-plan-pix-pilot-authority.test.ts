import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../server/payments/officialPlanPixCheckout.ts', import.meta.url), 'utf8');

test('official Pix pilot never hardcodes a commercial price', () => {
  const pilot = source.split('const allowPilotOffer =')[1]?.split('const now =')[0];
  assert.ok(pilot);
  assert.doesNotMatch(pilot, /19700|19990|39700|7990/);
  assert.match(pilot, /d\.offer\.quote\.totalMinor !== d\.offer\.priceMinor/);
  assert.match(pilot, /d\.offer\.plan !== 'pro'/);
  assert.match(pilot, /d\.offer\.quote\.months !== 1/);
});

test('provider issuance still requires canonical offer revalidation and pilot buyer gate', () => {
  assert.match(source, /digest\(fresh\) !== d\.offerDigest/);
  assert.match(source, /uid !== pilotUid\(\)/);
  assert.match(source, /OFFICIAL_PIX_PILOT_ALREADY_USED/);
  assert.match(source, /OFFICIAL_PIX_PENDING_ACTIVATION_NOT_READY/);
});
