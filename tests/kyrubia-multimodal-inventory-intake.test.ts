import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildKyrubInventoryAttachmentIntakeProposal,
  isKyrubInventoryAttachmentIntakeIntent,
  parseKyrubInventoryIntakeEntries,
} from '../shared/kyrubInventoryIntake';

const multimodalClient = readFileSync(
  'src/ai/multimodalConsultantClient.ts',
  'utf8'
);

test('attachment analysis alone never becomes an inventory mutation', () => {
  assert.equal(
    isKyrubInventoryAttachmentIntakeIntent(
      'Analise somente o estoque que aparece nesta nota fiscal.'
    ),
    false
  );
  assert.equal(
    isKyrubInventoryAttachmentIntakeIntent(
      'O que aparece nesta nota fiscal?'
    ),
    false
  );
});

test('explicit stock intake request allows strict attachment proposal building', () => {
  const userMessage =
    'Use esta nota fiscal para atualizar meu estoque. Dê entrada, mas só depois da minha confirmação.';
  assert.equal(isKyrubInventoryAttachmentIntakeIntent(userMessage), true);

  const proposal = buildKyrubInventoryAttachmentIntakeProposal(
    userMessage,
    [
      'Fornecedor: Distribuidora Exemplo',
      '30 UN Pão para hambúrguer',
      'Carne bovina Premium — 12 KG',
      '- 40 unidades de Queijo para hambúrguer',
      'Batata frita  8 KG',
    ].join('\n'),
    'conversation-a',
    ['att_invoice_a']
  );

  assert.ok(proposal);
  assert.equal(proposal.type, 'adjust_inventory');
  assert.equal(proposal.mode, 'increment');
  assert.equal(proposal.requiresConfirmation, true);
  assert.equal(proposal.source.kind, 'supplier_invoice');
  assert.equal(proposal.source.label, 'Distribuidora Exemplo');
  assert.equal(proposal.inputProvenance, 'document_content');
  assert.equal(proposal.entries.length, 4);
  assert.deepEqual(proposal.entries[0], {
    name: 'Pão para hambúrguer',
    quantity: 30,
    unit: 'un',
  });
  assert.deepEqual(proposal.entries[1], {
    name: 'Carne bovina Premium',
    quantity: 12,
    unit: 'kg',
  });
});

test('same observed invoice and attachment identity produce the same idempotent proposal id', () => {
  const message = 'Atualize o estoque com esta nota fiscal.';
  const observed = '20 UN Pão\n5 KG Carne';
  const first = buildKyrubInventoryAttachmentIntakeProposal(
    message,
    observed,
    'conversation-stable',
    ['att_b', 'att_a']
  );
  const second = buildKyrubInventoryAttachmentIntakeProposal(
    message,
    observed,
    'conversation-stable',
    ['att_a', 'att_b']
  );

  assert.ok(first);
  assert.ok(second);
  assert.equal(first.id, second.id);
});

test('ambiguous package descriptions never become deterministic stock entries', () => {
  assert.deepEqual(
    parseKyrubInventoryIntakeEntries(
      '2 caixas Pão para hambúrguer\n3 pacotes Queijo\nValor total: 120,00'
    ),
    []
  );
  assert.equal(
    buildKyrubInventoryAttachmentIntakeProposal(
      'Atualize meu estoque com esta nota fiscal.',
      '2 caixas Pão para hambúrguer\n3 pacotes Queijo',
      'conversation-ambiguous',
      ['att_invoice']
    ),
    null
  );
});

test('multimodal client enriches only proposal-free responses and reuses standard confirmation events', () => {
  assert.match(
    multimodalClient,
    /buildKyrubInventoryAttachmentIntakeProposal/
  );
  assert.match(multimodalClient, /if \(result\.actionProposal\) return result/);
  assert.match(multimodalClient, /latestAttachmentMessage/);
  assert.match(multimodalClient, /actionProposal: proposal/);
  assert.match(multimodalClient, /emitKyrubAiActionProposal/);
  assert.doesNotMatch(multimodalClient, /firebase\/firestore|setDoc\(|updateDoc\(|runTransaction\(/);
});
