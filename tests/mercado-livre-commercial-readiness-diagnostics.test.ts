import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const requirementsPath = new URL(
  '../server/integrations/mercadoLivreCommercialRequirementsService.ts',
  import.meta.url
);
const transportPath = new URL(
  '../server/integrations/mercadoLivreCommercialReadTransport.ts',
  import.meta.url
);
const readinessPath = new URL(
  '../server/integrations/mercadoLivreKyrubiaCommercialReadinessService.ts',
  import.meta.url
);

test('Mercado Livre commercial readiness uses provider prepublication shipping modes', async () => {
  const requirements = await readFile(requirementsPath, 'utf8');
  const readiness = await readFile(readinessPath, 'utf8');

  assert.match(requirements, /mercadoLivreCommercialGetJson/);
  assert.match(requirements, /mercadoLivreCommercialPostJson/);
  assert.match(requirements, /category_sale_terms/);
  assert.match(requirements, /prepublication_shipping_modes/);
  assert.match(requirements, /\/shipping_modes/);
  assert.doesNotMatch(requirements, /seller_shipping_preferences/);
  assert.doesNotMatch(requirements, /category_shipping_preferences/);

  assert.match(requirements, /site_id/);
  assert.match(requirements, /seller_id/);
  assert.match(requirements, /category_id/);
  assert.match(requirements, /catalog/);
  assert.match(requirements, /listing_type_id/);
  assert.match(requirements, /buying_mode/);
  assert.match(requirements, /condition/);
  assert.match(requirements, /channels/);
  assert.match(requirements, /new_format/);
  assert.match(requirements, /verbose/);

  assert.match(readiness, /providerSiteId/);
  assert.match(readiness, /providerListingTypeId/);
  assert.match(readiness, /providerCondition/);
  assert.match(readiness, /providerCurrencyId/);
  assert.match(readiness, /requirementConfiguration\.attributes/);
});

test('commercial readiness diagnostics expose provider status without leaking credentials', async () => {
  const transport = await readFile(transportPath, 'utf8');
  assert.match(transport, /Mercado Livre commercial readiness rejection/);
  assert.match(transport, /Mercado Livre prepublication shipping diagnostic/);
  assert.match(transport, /prepublicationShippingDiagnostic/);
  assert.match(transport, /shippingRuleDiagnostic/);
  assert.match(transport, /shippingAttributes/);
  assert.match(transport, /logisticTypes/);
  assert.match(transport, /freeShipping/);
  assert.match(transport, /localPickUp/);
  assert.match(transport, /status/);
  assert.match(transport, /providerCode/);
  assert.match(transport, /providerError/);
  assert.match(transport, /providerMessage/);
  assert.match(transport, /Bearer \[redacted\]/);
  assert.match(transport, /\[email\]/);
  assert.match(transport, /MERCADO_LIVRE_API_FAILED:HTTP_/);
  assert.match(transport, /method: 'POST'/);
  assert.match(transport, /x-multichannel/);
  assert.match(transport, /x-format-new/);
  assert.doesNotMatch(transport, /console\.(?:log|error)\([^\n]*accessToken/);
});
