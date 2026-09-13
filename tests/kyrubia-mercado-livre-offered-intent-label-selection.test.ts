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
