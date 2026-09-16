import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  isDirectStaffLinkAllowed,
  maskCustomerEmail,
  maskCustomerPhone,
  parseInPersonCustomerLinkInput,
  parseInPersonCustomerLookupInput,
  phoneLookupVariants,
} from '../shared/inPersonCustomerIdentity';

describe('in-person customer linking', () => {
  test('normalizes exact CPF and phone lookup while keeping name lookup non-authoritative', () => {
    assert.deepEqual(
      parseInPersonCustomerLookupInput({
        storeId: ' store-1 ',
        orderId: ' staff-order-1 ',
        kind: 'cpf',
        query: '123.456.789-01',
      }),
      {
        storeId: 'store-1',
        orderId: 'staff-order-1',
        kind: 'cpf',
        query: '12345678901',
      }
    );
    assert.deepEqual(
      parseInPersonCustomerLookupInput({
        storeId: 'store-1',
        orderId: 'staff-order-1',
        kind: 'phone',
        query: '(11) 98765-4321',
      }).query,
      '11987654321'
    );
    assert.equal(
      parseInPersonCustomerLookupInput({
        storeId: 'store-1',
        orderId: 'staff-order-1',
        kind: 'name',
        query: ' Maria Silva ',
      }).query,
      'Maria Silva'
    );
    assert.equal(isDirectStaffLinkAllowed('name', true), false);
    assert.equal(isDirectStaffLinkAllowed('cpf', true), true);
    assert.equal(isDirectStaffLinkAllowed('phone', true), true);
    assert.equal(isDirectStaffLinkAllowed('cpf', false), false);
    assert.throws(
      () => parseInPersonCustomerLookupInput({
        storeId: 'store-1',
        orderId: 'staff-order-1',
        kind: 'name',
        query: 'Al',
      }),
      /NAME_TOO_SHORT/
    );
  });

  test('supports common Brazilian phone formats without exposing the raw value in the candidate mask', () => {
    const variants = phoneLookupVariants('(11) 98765-4321');
    assert.ok(variants.includes('11987654321'));
    assert.ok(variants.includes('(11) 98765-4321'));
    assert.ok(variants.includes('+5511987654321'));
    assert.ok(variants.length <= 10);
    assert.equal(maskCustomerPhone('(11) 98765-4321'), '••••••4321');
    assert.equal(maskCustomerEmail('maria.silva@example.com'), 'ma*****@example.com');
  });

  test('link request carries only an opaque customerRef, never raw customer identity fields', () => {
    assert.deepEqual(
      parseInPersonCustomerLinkInput({
        storeId: 'store-1',
        orderId: 'staff-order-1',
        customerRef: 'opaque-ref-1',
      }),
      {
        storeId: 'store-1',
        orderId: 'staff-order-1',
        customerRef: 'opaque-ref-1',
      }
    );
  });

  test('server lookup keeps private identity behind approved exact CPF or phone matches', () => {
    const service = readFileSync(
      'server/attendance/inPersonCustomerIdentityService.ts',
      'utf8'
    );
    assert.match(service, /collection\('identity_verifications'\)/);
    assert.match(service, /\.where\('cpf', '==', query\)/);
    assert.match(service, /\.where\('whatsapp', 'in', phoneLookupVariants\(query\)\)/);
    assert.match(service, /identityVerified = identity\?\.status === 'approved'/);
    assert.match(service, /isDirectStaffLinkAllowed\(input\.kind, candidate\.identityVerified\)/);
    assert.match(service, /customerLookupTokens/);
    assert.match(service, /LOOKUP_TOKEN_TTL_MS = 10 \* 60 \* 1000/);
    assert.match(service, /requestedByUserId: input\.actorUserId/);
    assert.match(service, /exactPrivateMatch: true/);
    assert.doesNotMatch(service, /candidate:\s*\{[^}]*cpf/s);
    assert.doesNotMatch(service, /candidate:\s*\{[^}]*whatsapp/s);
  });

  test('name discovery never receives a link token and explicitly requires another confirmation', () => {
    const service = readFileSync(
      'server/attendance/inPersonCustomerIdentityService.ts',
      'utf8'
    );
    assert.match(service, /const linkable = isDirectStaffLinkAllowed\(input\.kind, candidate\.identityVerified\)/);
    assert.match(service, /customerRef = ''/);
    assert.match(service, /requiresCustomerConfirmation: !linkable/);
  });

  test('linking revalidates the customer and updates both order representations plus CRM relationship', () => {
    const service = readFileSync(
      'server/attendance/inPersonCustomerIdentityService.ts',
      'utf8'
    );
    assert.match(service, /identity\.status !== 'approved'/);
    assert.match(service, /buyerIdentityStatus: 'verified_account'/);
    assert.match(service, /buyerIdentityMethod: `staff_exact_\$\{token\.lookupKind\}`/);
    assert.match(service, /transaction\.set\(legacyReference, orderUpdate, \{ merge: true \}\)/);
    assert.match(service, /transaction\.set\(canonicalReference, orderUpdate, \{ merge: true \}\)/);
    assert.match(service, /customerRelationships/);
    assert.match(service, /source: 'in_person_identification'/);
    assert.match(service, /transaction\.delete\(tokenReference\)/);

    const linkStart = service.indexOf('export const linkInPersonOrderCustomer');
    const linkBlock = service.slice(linkStart);
    assert.doesNotMatch(linkBlock, /storePointLedger|rewardRedemptions|invoice|notaFiscal|fiscalEmission/i);
    assert.doesNotMatch(linkBlock, /transaction\.set\([^\n]*payments\//);
    assert.doesNotMatch(linkBlock, /cpf:\s|whatsapp:\s/);
  });

  test('payment context is read from canonical payment evidence and can expose unattributed payment', () => {
    const service = readFileSync(
      'server/attendance/inPersonCustomerIdentityService.ts',
      'utf8'
    );
    assert.match(service, /collection\(paymentCollectionPath\(context\.canonicalStoreId\)\)/);
    assert.match(service, /\.where\('orderId', '==', orderId\)/);
    assert.match(service, /isPaymentAuthoritativelyPaid\(payment\.status\)/);
    assert.match(service, /'paid_unattributed'/);
    assert.match(service, /'reconciliation_required'/);
    assert.doesNotMatch(service, /request\.body.*paymentStatus|mark.*paid/i);
  });

  test('CRM includes explicit customer relationships but never operational local-order handles', () => {
    const crm = readFileSync('server/payments/storeCrmService.ts', 'utf8');
    assert.match(crm, /customerRelationships/);
    assert.match(crm, /relationshipSnapshot/);
    assert.match(crm, /!customerId\.startsWith\('local-order:'\)/);
    assert.match(crm, /isPaymentAuthoritativelyPaid\(payment\.status\)/);
    assert.match(crm, /confirmedPurchases: paid\.length/);
  });

  test('browser never receives or sends a raw UID for linking and has no direct Firestore writes', () => {
    const client = readFileSync('src/utils/inPersonCustomerIdentity.ts', 'utf8');
    assert.match(client, /customerRef: string/);
    assert.match(client, /\/api\/local-attendance\/customers\/search/);
    assert.match(client, /\/api\/local-attendance\/customers\/link/);
    assert.doesNotMatch(client, /customerId:\s*string/);
    assert.doesNotMatch(client, /setDoc|updateDoc|writeBatch|collection\(db|doc\(db/);
  });

  test('PDV explains identity and payment boundaries and never offers a manual paid toggle', () => {
    const bridge = readFileSync('src/components/store/LocalServicePdvBridge.tsx', 'utf8');
    const linker = readFileSync('src/components/store/InPersonCustomerLinker.tsx', 'utf8');
    assert.match(bridge, /<InPersonCustomerLinker storeId=\{user\.uid\} orders=\{orders\} \/>/);
    assert.match(linker, /Nome serve para localizar candidatos, mas não autoriza o vínculo sozinho/);
    assert.match(linker, /CPF ou telefone exato/);
    assert.match(linker, /Pagamento confirmado, ainda não atribuído ao Cairuvi/);
    assert.match(linker, /Identificar o Cairuvi não confirma pagamento, não gera pontos/);
    assert.match(linker, /window\.setInterval/);
    assert.match(linker, /10000/);
    assert.doesNotMatch(linker, /Marcar como pago|Confirmar pagamento manualmente|setPaymentStatus/i);
  });

  test('local attendance mounts owner-authorized customer search and link endpoints', () => {
    const parent = readFileSync('server/attendance/localAttendanceRouter.ts', 'utf8');
    const router = readFileSync('server/attendance/inPersonCustomerIdentityRouter.ts', 'utf8');
    assert.match(parent, /router\.use\('\/customers', createInPersonCustomerIdentityRouter\(\)\)/);
    assert.match(router, /verifyFirebaseIdToken\(token\)/);
    assert.match(router, /loadOwnerStoreInstitutionalRepresentation/);
    assert.match(router, /router\.post\('\/search'/);
    assert.match(router, /router\.get\('\/context'/);
    assert.match(router, /router\.post\('\/link'/);
  });
});
