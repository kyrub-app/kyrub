import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveKyrubiaOfferedIntentSelection,
  type KyrubiaTurnContext,
} from '../shared/kyrubiaContext';

const context: KyrubiaTurnContext = {
  version: 1,
  id: 'turn-1',
  source: 'kyrub_runtime',
  sourceAction: 'mercado_livre_publication_preparation',
  generatedAt: new Date().toISOString(),
  scope: { kind: 'own_store', storeId: 'owner' },
  entities: [{ entityType: 'product', entityId: 'p1', label: 'Chaveiro Acrílico', position: 1 }],
  offeredIntents: [
    {
      id: 'intent-1',
      intent: 'mercado_livre.category_select',
      label: 'Chaveiros · ID MLB439316 · Indústria e Comércio > Publicidade e Promoção > Merchandising > Chaveiros',
      payload: {
        proposalId: 'proposal-1',
        categoryId: 'MLB439316',
        categoryName: 'Chaveiros',
        providerAuthority: 'provider_api_refetch',
      },
      authorization: 'intent_only',
      primary: true,
    },
    {
      id: 'intent-2',
      intent: 'mercado_livre.category_select',
      label: 'Chaveiros · ID MLB123456 · Moda > Acessórios > Chaveiros',
      payload: {
        proposalId: 'proposal-1',
        categoryId: 'MLB123456',
        categoryName: 'Chaveiros',
        providerAuthority: 'provider_api_refetch',
      },
      authorization: 'intent_only',
    },
  ],
};

const listingTypeContext: KyrubiaTurnContext = {
  ...context,
  id: 'turn-listing-types',
  sourceAction: 'mercado_livre_requirement_options',
  offeredIntents: [
    ['gold_pro', 'Premium'],
    ['gold_premium', 'Diamante'],
    ['gold_special', 'Clássico'],
    ['gold', 'Ouro'],
    ['silver', 'Prata'],
    ['bronze', 'Bronze'],
    ['free', 'Grátis'],
  ].map(([listingTypeId, listingTypeName], index) => ({
    id: `listing-${index + 1}`,
    intent: 'mercado_livre.listing_type_select' as const,
    label: listingTypeName,
    payload: {
      proposalId: 'proposal-1',
      categoryId: 'MLB439316',
      categoryName: 'Chaveiros',
      condition: 'new',
      listingTypeId,
      listingTypeName,
      providerAuthority: 'provider_api_requirement_options' as const,
    },
    authorization: 'intent_only' as const,
    ...(index === 0 ? { primary: true } : {}),
  })),
};

test('resolves an offered Mercado Livre option from the exact visible label', () => {
  const selection = resolveKyrubiaOfferedIntentSelection({
    message: context.offeredIntents?.[0]?.label ?? '',
    context,
  });
  assert.equal(selection?.offeredIntent.id, 'intent-1');
});

test('resolves a category option when the user message uniquely mentions its provider category id', () => {
  const selection = resolveKyrubiaOfferedIntentSelection({
    message: 'Merchandising > Chaveiros (ID: MLB439316)',
    context,
  });
  assert.equal(selection?.offeredIntent.id, 'intent-1');
});

test('resolves a visible Mercado Livre listing type beyond the first three options', () => {
  const selection = resolveKyrubiaOfferedIntentSelection({
    message: 'Ouro',
    context: listingTypeContext,
  });
  assert.equal(selection?.offeredIntent.id, 'listing-4');
  assert.equal(selection?.resolution, 'label');
});

test('resolves the seventh visible Mercado Livre listing type by provider id', () => {
  const selection = resolveKyrubiaOfferedIntentSelection({
    message: 'Quero o anúncio free',
    context: listingTypeContext,
  });
  assert.equal(selection?.offeredIntent.id, 'listing-7');
  assert.equal(selection?.resolution, 'provider_id');
});
