import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  createEmptyProductFiscalProfile,
  normalizeProductFiscalProfile,
  parseProductFiscalProfiles,
} from '../src/utils/productFiscal';

const editorSource = readFileSync(
  'src/components/store/ProductEditorModal.tsx',
  'utf8'
);
const fieldsSource = readFileSync(
  'src/components/store/ProductFiscalFieldsBridge.tsx',
  'utf8'
);
const rulesSource = readFileSync(
  'firestore.product-inventory.fragment.rules',
  'utf8'
);

test('disabled fiscal preparation keeps the item free of fiscal requirements', () => {
  const draft = createEmptyProductFiscalProfile('goods');
  assert.equal(normalizeProductFiscalProfile(draft, 'goods'), null);
});

test('goods fiscal profile validates NCM, optional CEST and GTIN semantics', () => {
  const draft = {
    ...createEmptyProductFiscalProfile('goods'),
    enabled: true,
    fiscalDescription: 'Refrigerante lata 350 ml',
    ncm: '22021000',
    cest: '0300700',
    noGtin: false,
    gtin: '7894900011517',
  };

  const normalized = normalizeProductFiscalProfile(draft, 'goods');
  assert.ok(normalized);
  assert.equal(normalized.ncm, '22021000');
  assert.equal(normalized.cest, '0300700');
  assert.equal(normalized.gtin, '7894900011517');
  assert.equal(normalized.kind, 'goods');
});

test('goods profile rejects incomplete NCM and invalid GTIN', () => {
  const draft = {
    ...createEmptyProductFiscalProfile('goods'),
    enabled: true,
    fiscalDescription: 'Produto de teste',
    ncm: '1234',
  };
  assert.throws(
    () => normalizeProductFiscalProfile(draft, 'goods'),
    /NCM deve conter exatamente 8 dígitos/
  );

  assert.throws(
    () =>
      normalizeProductFiscalProfile(
        {
          ...draft,
          ncm: '22021000',
          noGtin: false,
          gtin: '12345678',
        },
        'goods'
      ),
    /GTIN\/EAN válido/
  );
});

test('service profile uses service classification instead of NCM', () => {
  const normalized = normalizeProductFiscalProfile(
    {
      ...createEmptyProductFiscalProfile('service'),
      enabled: true,
      fiscalDescription: 'Manutenção preventiva',
      serviceListCode: '14.01',
      ncm: '99999999',
    },
    'service'
  );

  assert.ok(normalized);
  assert.equal(normalized.kind, 'service');
  assert.equal(normalized.serviceListCode, '14.01');
  assert.equal(normalized.ncm, '');
});

test('stored fiscal profiles discard invalid ids and disabled entries', () => {
  const parsed = parseProductFiscalProfiles({
    'product-1': {
      ...createEmptyProductFiscalProfile('goods'),
      enabled: true,
      fiscalDescription: 'Produto',
      ncm: '22021000',
    },
    'invalid/id': {
      ...createEmptyProductFiscalProfile('goods'),
      enabled: true,
    },
    disabled: createEmptyProductFiscalProfile('goods'),
  });

  assert.deepEqual(Object.keys(parsed), ['product-1']);
});

test('product editor mounts private fiscal fields and rolls them back on save failure', () => {
  assert.match(editorSource, /ProductFiscalFieldsBridge/);
  assert.match(editorSource, /normalizeProductFiscalProfile/);
  assert.match(editorSource, /persistProductFiscalProfile/);
  assert.match(editorSource, /previousFiscalProfile/);
  assert.match(editorSource, /Não foi possível reverter os dados fiscais/);
});

test('fiscal interface separates goods and services without exposing tax rates', () => {
  assert.match(fieldsSource, /Dados fiscais e nota/);
  assert.match(fieldsSource, /Preparar este item para emissão fiscal/);
  assert.match(fieldsSource, /NCM · 8 dígitos/);
  assert.match(fieldsSource, /CEST · quando aplicável/);
  assert.match(fieldsSource, /GTIN\/EAN/);
  assert.match(fieldsSource, /Origem da mercadoria/);
  assert.match(fieldsSource, /Item da lista de serviços/);
  assert.match(fieldsSource, /Código municipal do serviço/);
  assert.doesNotMatch(fieldsSource, /Alíquota de ICMS/);
  assert.doesNotMatch(fieldsSource, /CFOP padrão/);
});

test('private inventory rules admit only an owner fiscal map', () => {
  assert.match(rulesSource, /productFiscalProfiles/);
  assert.match(rulesSource, /data\.productFiscalProfiles is map/);
  assert.match(rulesSource, /request\.auth\.uid == userId/);
  assert.match(rulesSource, /productFiscalProfiles\.size\(\) <= 200/);
});
