import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('admin exposes customer arrival policy through authenticated server transport', async () => {
  const router = await readFile(new URL('../server/admin/operationsHealthRouter.ts', import.meta.url), 'utf8');
  assert.match(router, /customer-arrival-policy/);
  assert.match(router, /loadAuthorizedCustomerArrivalPolicy/);
  assert.match(router, /saveAuthorizedCustomerArrivalPolicy/);
});

test('customer arrival policy writes require super admin and strictly increasing versions', async () => {
  const service = await readFile(new URL('../server/admin/customerArrivalPolicyAdminService.ts', import.meta.url), 'utf8');
  assert.match(service, /authorizeIntegrationReadiness/);
  assert.match(service, /version <= existingVersion/);
  assert.match(service, /CUSTOMER_ARRIVAL_POLICY_VERSION_MUST_INCREASE/);
  assert.match(service, /radiusMeters/);
  assert.match(service, /platform_operational_policy/);
});

test('admin UI has explicit radius, version and activation controls without a hidden default', async () => {
  const card = await readFile(new URL('../src/components/admin/AdminCustomerArrivalPolicyCard.tsx', import.meta.url), 'utf8');
  const workspace = await readFile(new URL('../src/components/admin/AdminIntegrationsWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(card, /Raio de chegada \(metros\)/);
  assert.match(card, /Nova versão/);
  assert.match(card, /Ativar esta versão para novas entregas/);
  assert.match(card, /placeholder="Defina explicitamente"/);
  assert.doesNotMatch(card, /radiusMeters[^\n]*=\s*\d+/);
  assert.match(workspace, /AdminCustomerArrivalPolicyCard/);
});

test('runtime arrival policy remains distinct from Google Maps credentials and geocoding', async () => {
  const policy = await readFile(new URL('../server/delivery/deliveryCustomerArrivalPolicyService.ts', import.meta.url), 'utf8');
  const geocoding = await readFile(new URL('../server/delivery/customerDestinationGeocodingService.ts', import.meta.url), 'utf8');
  assert.match(policy, /platformOperationalPolicies\/deliveryCustomerArrival/);
  assert.doesNotMatch(policy, /GOOGLE_MAPS_API_KEY/);
  assert.doesNotMatch(geocoding, /radiusMeters/);
});
