import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  getBrazilFiscalTaxIdentifierKind,
  isValidBrazilFiscalTaxIdentifier,
  normalizeBrazilFiscalTaxIdentifier,
} from '../src/utils/brazilFiscalIdentifier';

const serviceSource = readFileSync(
  'server/attendance/fiscalConsumerIdentityService.ts',
  'utf8'
);
const routerSource = readFileSync(
  'server/attendance/inPersonOrderRouter.ts',
  'utf8'
);
const checkoutSource = readFileSync(
  'src/components/customer/FiscalConsumerIdentityCheckout.tsx',
  'utf8'
);
const workspaceSource = readFileSync(
  'src/components/customer/TableServiceWorkspace.tsx',
  'utf8'
);
const preflightSource = readFileSync(
  'server/integrations/fiscalPreflightReadService.ts',
  'utf8'
);

test('CPF/CNPJ consumer input uses the existing Brazil fiscal identifier validator', () => {
  assert.equal(normalizeBrazilFiscalTaxIdentifier('529.982.247-25'), '52998224725');
  assert.equal(getBrazilFiscalTaxIdentifierKind('529.982.247-25'), 'cpf');
  assert.equal(isValidBrazilFiscalTaxIdentifier('529.982.247-25'), true);
  assert.equal(getBrazilFiscalTaxIdentifierKind('11.222.333/0001-81'), 'cnpj');
  assert.equal(isValidBrazilFiscalTaxIdentifier('11.222.333/0001-81'), true);
  assert.equal(isValidBrazilFiscalTaxIdentifier('111.111.111-11'), false);
});

test('consumer fiscal identity is persisted only on canonical orders in one transaction', () => {
  assert.match(serviceSource, /stores\/\$\{context\.canonicalStoreId\}\/orders\/\$\{orderId\}/);
  assert.match(serviceSource, /adminDb\.runTransaction/);
  assert.match(serviceSource, /transaction\.set\(ref/);
  assert.match(serviceSource, /fiscalConsumerIdentity/);
  assert.match(serviceSource, /source: 'staff_checkout'/);
  assert.doesNotMatch(serviceSource, /artifacts\//);
  assert.doesNotMatch(serviceSource, /LEGACY_ORDER_ROOT/);
  assert.doesNotMatch(serviceSource, /console\.(log|warn|error)/);
});

test('consumer document readback is masked instead of returning the full identifier', () => {
  assert.match(serviceSource, /maskTaxIdentifier/);
  assert.match(serviceSource, /maskedTaxIdentifier/);
  const resultBlock = serviceSource.slice(serviceSource.indexOf('export interface FiscalConsumerIdentitySummary'));
  assert.doesNotMatch(resultBlock.slice(0, resultBlock.indexOf('interface StoredFiscalConsumerIdentity')), /taxIdentifier: string/);
});

test('checkout API is owner-authenticated and accepts only selected order ids plus tax identifier', () => {
  assert.match(routerSource, /router\.get\('\/fiscal-consumer-identity'/);
  assert.match(routerSource, /router\.put\('\/fiscal-consumer-identity'/);
  assert.match(routerSource, /authorizeOwnerStore/);
  assert.match(routerSource, /orderIds: request\.body\?\.orderIds/);
  assert.match(routerSource, /taxIdentifier: request\.body\?\.taxIdentifier/);
  assert.doesNotMatch(routerSource, /request\.body\?\.canonicalStoreId/);
  assert.doesNotMatch(routerSource, /request\.body\?\.identifierKind/);
});

test('staff checkout keeps consumer identity optional and scoped to selected payment orders', () => {
  assert.match(checkoutSource, /Documento fiscal do consumidor/);
  assert.match(checkoutSource, /CPF\/CNPJ opcional neste momento/);
  assert.match(checkoutSource, /orderIds=|orderIds:/);
  assert.match(workspaceSource, /paymentDraft\.orderIds/);
  assert.match(workspaceSource, /staff-checkout-fiscal-consumer-identity-host/);
  assert.doesNotMatch(checkoutSource, /required=\{?true\}?/);
  assert.doesNotMatch(checkoutSource, /Emitir|SEFAZ|provider/i);
});

test('canonical fiscal preflight exposes masked consumer identity as evidence without making it a global blocker', () => {
  assert.match(preflightSource, /consumerIdentity: FiscalConsumerIdentityEvidence/);
  assert.match(preflightSource, /consumerIdentityAuthority: 'canonical_order_fiscal_consumer_identity'/);
  assert.match(preflightSource, /maskedTaxIdentifier/);
  assert.match(preflightSource, /status: 'not_provided'/);
  assert.doesNotMatch(preflightSource, /consumer_identity_required/);
});
