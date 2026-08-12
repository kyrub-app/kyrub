import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { resolveKyrubiaDeterministicStoreProfileUpdate } from '../src/ai/deterministicStoreProfileUpdate';

test('explicit store name update is parsed without generative AI', () => {
  const result = resolveKyrubiaDeterministicStoreProfileUpdate(
    'Altere o nome da minha loja para Casa Aurora'
  );
  assert.deepEqual(result, {
    field: 'name',
    patch: { name: 'Casa Aurora' },
  });
});

test('explicit description, address and contact updates preserve user values', () => {
  assert.deepEqual(
    resolveKyrubiaDeterministicStoreProfileUpdate(
      'Atualize a descrição da loja para Presentes artesanais feitos sob encomenda'
    ),
    {
      field: 'description',
      patch: { description: 'Presentes artesanais feitos sob encomenda' },
    }
  );

  assert.deepEqual(
    resolveKyrubiaDeterministicStoreProfileUpdate(
      'Mude o endereço da loja para Av. Brasil, 120 - Centro'
    ),
    {
      field: 'address',
      patch: { address: 'Av. Brasil, 120 - Centro' },
    }
  );

  assert.deepEqual(
    resolveKyrubiaDeterministicStoreProfileUpdate(
      'Troque o contato da loja para (11) 99999-0000'
    ),
    {
      field: 'contact',
      patch: { contact: '(11) 99999-0000' },
    }
  );
});

test('explicit store keywords are normalized and deduplicated', () => {
  assert.deepEqual(
    resolveKyrubiaDeterministicStoreProfileUpdate(
      'Atualize as palavras-chave da minha loja para Roupas, Moda Feminina, roupas, Acessórios'
    ),
    {
      field: 'keywords',
      patch: { keywords: ['roupas', 'moda feminina', 'acessórios'] },
    }
  );
});

test('ambiguous or creative profile requests are not guessed locally', () => {
  assert.equal(
    resolveKyrubiaDeterministicStoreProfileUpdate(
      'Melhore a descrição da minha loja para vender mais'
    ),
    null
  );
  assert.equal(
    resolveKyrubiaDeterministicStoreProfileUpdate(
      'Altere o nome da minha loja e o contato da minha loja'
    ),
    null
  );
  assert.equal(
    resolveKyrubiaDeterministicStoreProfileUpdate('Mude minha loja'),
    null
  );
});

test('standalone profile writes are routed locally but remain confirmation-bound on the server', async () => {
  const [
    workflowSource,
    actionProtocolSource,
    policySource,
    executionSource,
    bridgeSource,
    actionClientSource,
  ] = await Promise.all([
    readFile(new URL('../src/ai/operationalWorkflowRuntime.ts', import.meta.url), 'utf8'),
    readFile(new URL('../shared/kyrubActions.ts', import.meta.url), 'utf8'),
    readFile(new URL('../server/actions/kyrubiaPolicyEngine.ts', import.meta.url), 'utf8'),
    readFile(new URL('../server/actions/actionExecutionService.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/KyrubAiNoteActionBridge.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/actions/kyrubActionService.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(workflowSource, /resolveKyrubiaDeterministicStoreProfileUpdate/);
  assert.match(workflowSource, /requiresConfirmation:\s*true/);
  assert.match(workflowSource, /inputProvenance:\s*'user_intent'/);
  assert.match(workflowSource, /store\?\.configured/);

  assert.match(actionProtocolSource, /activationGrantId\?: string/);
  assert.match(actionProtocolSource, /requiresConfirmation:\s*boolean/);

  assert.match(
    policySource,
    /definition\.requiresConfirmation\s*\|\|\s*proposal\.requiresConfirmation/
  );

  assert.match(executionSource, /authorizationMode:\s*'human_confirmation'/);
  assert.match(executionSource, /STORE_ACTIVATION_REQUIRED/);
  assert.match(executionSource, /proposal\.requiresConfirmation === false/);

  assert.match(bridgeSource, /KyrubAiUpdateStoreProfileProposal/);
  assert.match(bridgeSource, /detail\.proposal\.type !== 'update_store_profile'/);
  assert.match(actionClientSource, /proposal\.type === 'update_store_profile'/);
});
