import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync('src/App.tsx', 'utf8');
const deliveryModalSource = readFileSync(
  'src/components/modals/DeliveryManagerModal.tsx',
  'utf8'
);
const orderInboxSource = readFileSync(
  'src/components/customer/CustomerOrderInbox.tsx',
  'utf8'
);
const orderWorkflowSource = readFileSync('src/utils/orderWorkflow.ts', 'utf8');
const orderRouterSource = readFileSync(
  'server/inventory/orderInventoryRouter.ts',
  'utf8'
);
const opportunityBridgeSource = readFileSync(
  'src/components/store/KyrubDeliveryOpportunityBridge.tsx',
  'utf8'
);
const deliveryRouterSource = readFileSync(
  'server/delivery/deliveryOpportunityRouter.ts',
  'utf8'
);

test('RC1 bootstrap shields auth restoration and legacy remounts', () => {
  assert.match(appSource, /authResolved/);
  assert.match(appSource, /KyrubBootstrapScreen/);
  assert.match(appSource, /Restaurando sua sessão/);
  assert.match(appSource, /legacyRefreshing/);
});

test('manual delivery never fabricates distance or price', () => {
  assert.doesNotMatch(deliveryModalSource, /Math\.random/);
  assert.doesNotMatch(deliveryModalSource, /Taxa Mínima Base/);
  assert.doesNotMatch(deliveryModalSource, /União de Entregadores/);
  assert.doesNotMatch(deliveryModalSource, /ratePerKm/);
  assert.match(deliveryModalSource, /A calcular por geolocalização/);
  assert.match(deliveryModalSource, /Valor oferecido ao entregador/);
  assert.match(deliveryModalSource, /distance: 0/);
});

test('KDS requires a delivery-provider decision when accepting delivery orders', () => {
  assert.match(orderWorkflowSource, /OrderDeliveryProvider = 'kyrub' \| 'merchant'/);
  assert.match(orderInboxSource, /Solicitar entregador Kyrub/);
  assert.match(orderInboxSource, /Usar entregador próprio/);
  assert.match(orderInboxSource, /deliveryProvider: provider/);
  assert.match(orderRouterSource, /Escolha como a entrega será realizada/);
  assert.match(orderRouterSource, /persistDeliveryProvider/);
});

test('Kyrub courier opportunity starts at preparation and only for Kyrub logistics', () => {
  assert.match(opportunityBridgeSource, /deliveryProvider\) !== 'kyrub'/);
  assert.match(opportunityBridgeSource, /'preparing', 'ready', 'out_for_delivery'/);
  assert.match(deliveryRouterSource, /order\.deliveryProvider\) !== 'kyrub'/);
  assert.match(deliveryRouterSource, /'preparing', 'ready', 'out_for_delivery'/);
  assert.match(deliveryRouterSource, /orderStatus/);
});

test('courier can accept during preparation but cannot collect before ready', () => {
  assert.match(deliveryRouterSource, /status === 'accepted'/);
  assert.match(deliveryRouterSource, /status === 'delivering'/);
  assert.match(deliveryRouterSource, /O pedido ainda não está pronto para coleta/);
  assert.match(deliveryRouterSource, /'ready', 'out_for_delivery'/);
  assert.match(deliveryModalSource, /Pedido em preparo/);
  assert.match(deliveryModalSource, /Aguardar pronto/);
});
