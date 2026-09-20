import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { normalizeStoreOwnedPixConfiguration } from '../shared/storeOwnedPix.js';
import {
  buildStoreOwnedPixBrCode,
  createPixQrCodeDataUri,
} from '../server/payments/pixBrCode.js';

const workspace = readFileSync(
  'src/components/customer/TableServiceWorkspace.tsx',
  'utf8'
);
const financialPanel = readFileSync(
  'src/components/store/ServiceLocationFinancialContextPanel.tsx',
  'utf8'
);
const storePixConfirmation = readFileSync(
  'server/attendance/localStoreOwnedPixConfirmationService.ts',
  'utf8'
);
const storePixSecrets = readFileSync(
  'server/integrations/storeOwnedPixSecretStore.ts',
  'utf8'
);
const attendanceTransport = readFileSync(
  'server/attendance/localAttendanceServerlessTransport.ts',
  'utf8'
);
const storeConnectionsTransport = readFileSync(
  'server/integrations/storeConnectionsServerlessTransport.ts',
  'utf8'
);
const legacyWorkspace = readFileSync(
  'src/components/customer/LegacyTableServiceWorkspace.tsx',
  'utf8'
);
const operations = readFileSync('src/utils/tableOperations.ts', 'utf8');
const legacyOperations = readFileSync('src/utils/legacyTableOperations.ts', 'utf8');

test('staff table Pix click is intercepted before the legacy payment selector mutates state', () => {
  assert.match(workspace, /onClickCapture=\{interceptLegacyPix\}/);
  assert.match(workspace, /const PIX_LABEL = getTablePaymentMethodLabel\('pix'\)/);
  assert.match(workspace, /event\.preventDefault\(\)/);
  assert.match(workspace, /event\.stopPropagation\(\)/);
  assert.match(workspace, /setPixCheckoutOpen\(true\)/);
  assert.match(legacyWorkspace, /\(\['cash', 'pix', 'card', 'other'\] as TablePaymentMethod\[\]\)/);
});

test('staff table Pix reuses the canonical local payment panel instead of creating another checkout engine', () => {
  assert.match(workspace, /ServiceLocationFinancialContextPanel/);
  assert.match(workspace, /getActiveTableOrders\(props\.orders, props\.tableCode\)/);
  assert.match(workspace, /storeId=\{props\.storeId\}/);
  assert.match(workspace, /orders=\{activeOrders\}/);
  assert.match(workspace, /a seleção de itens da tela anterior não define o valor bancário/);
  assert.doesNotMatch(workspace, /createLocalPaymentIntent|attachLocalMercadoPagoPix|registerTablePayment/);
});

test('legacy table payment API fails closed for Pix before any operational settlement is delegated', () => {
  const guardIndex = operations.indexOf("if (input.method === 'pix')");
  const delegateIndex = operations.indexOf('return registerLegacyTablePayment(user, input);');
  assert.ok(guardIndex >= 0);
  assert.ok(delegateIndex > guardIndex);
  assert.match(operations, /não pode ser baixado como recebimento manual/);
  assert.match(legacyOperations, /public\/data\/tablePayments/);
  assert.match(legacyOperations, /paidQuantity: item\.paidQuantity \+ selectedQuantity/);
});

test('store-owned Pix configuration normalizes BR Code recipient data and validates the key', () => {
  const configuration = normalizeStoreOwnedPixConfiguration({
    keyType: 'email',
    key: ' Financeiro@Kyrub.COM ',
    recipientName: 'Loja São José',
    recipientCity: 'São Paulo',
  });
  assert.deepEqual(configuration, {
    keyType: 'email',
    key: 'financeiro@kyrub.com',
    recipientName: 'LOJA SAO JOSE',
    recipientCity: 'SAO PAULO',
    enabled: true,
  });
  assert.throws(
    () => normalizeStoreOwnedPixConfiguration({
      keyType: 'cpf', key: '111.111.111-11', recipientName: 'Loja', recipientCity: 'Recife',
    }),
    /STORE_PIX_CPF_INVALID/
  );
});

test('store-owned Pix BR Code is deterministic, server-valued and CRC protected', () => {
  const configuration = normalizeStoreOwnedPixConfiguration({
    keyType: 'email',
    key: 'teste@kyrub.com',
    recipientName: 'Loja Teste',
    recipientCity: 'Sao Paulo',
  });
  const result = buildStoreOwnedPixBrCode({
    configuration,
    amount: 29.5,
    paymentId: 'pay_local_test',
  });
  assert.equal(result.txid, '9CDC0CB2E54B065C6603D4916');
  assert.equal(
    result.payload,
    '00020126370014br.gov.bcb.pix0115teste@kyrub.com520400005303986540529.505802BR5910LOJA TESTE6009SAO PAULO622905259CDC0CB2E54B065C6603D491663041434'
  );
  const image = createPixQrCodeDataUri(result.payload);
  assert.match(image, /^data:image\/svg\+xml;base64,/);
  const svg = Buffer.from(image.split(',')[1], 'base64').toString('utf8');
  assert.match(svg, /viewBox="0 0 65 65"/);
  assert.match(svg, /shape-rendering="crispEdges"/);
});

test('store-owned Pix stays on existing serverless transports and keeps secrets server-side', () => {
  assert.match(storeConnectionsTransport, /createStoreOwnedPixRouter/);
  assert.match(storeConnectionsTransport, /\/api\/store-connections\/pix-own/);
  assert.match(attendanceTransport, /createLocalStoreOwnedPixRouter/);
  assert.match(storePixSecrets, /encryptIntegrationSecret/);
  assert.match(storePixSecrets, /integrationSecrets\/store_pix_receivables/);
  assert.doesNotMatch(storePixSecrets, /transaction\.update\([^)]*paidQuantity/);
});

test('manual store-owned Pix confirmation is explicit operator attestation, never a fake provider webhook', () => {
  assert.match(storePixConfirmation, /sourceAuthority: 'operator_attestation'/);
  assert.match(storePixConfirmation, /bankVerifiedByKyrub: false/);
  assert.match(storePixConfirmation, /confirmedCredit !== true/);
  assert.match(storePixConfirmation, /status: 'paid'/);
  assert.doesNotMatch(storePixConfirmation, /provider_webhook/);
  assert.doesNotMatch(storePixConfirmation, /paidQuantity|tablePayments|registerTablePayment/);
  assert.match(financialPanel, /O Kyrub não consultou o banco/);
  assert.match(financialPanel, /Conferi na conta recebedora/);
  assert.match(financialPanel, /Mercado Pago usa webhook verificado; Pix próprio usa declaração manual auditada/);
});
