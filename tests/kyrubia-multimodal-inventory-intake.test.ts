import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildKyrubInventoryAttachmentIntakeProposal,
  isKyrubInventoryAttachmentIntakeIntent,
  parseKyrubInventoryIntakeEntries,
} from '../shared/kyrubInventoryIntake';
import {
  buildGuidedPurchaseIntakeReply,
  shouldGuidePurchaseIntake,
} from '../shared/kyrubPurchaseIntakeGuidance';

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

test('invoice-first flow guides the merchant before any stock mutation', () => {
  const observed = [
    '10 UN Pão para hambúrguer',
    'Carne bovina Premium — 10 KG',
    '10 UN Queijo para hambúrguer',
    'Batata frita  1 KG',
  ].join('\n');

  assert.equal(
    shouldGuidePurchaseIntake('Leia esta nota fiscal para mim.', observed),
    true
  );
  const reply = buildGuidedPurchaseIntakeReply('Itens identificados:', observed);
  assert.match(reply, /Ainda não alterei seu estoque/);
  assert.match(reply, /Dar entrada como chegaram/);
  assert.match(reply, /Transformar ou porcionar algum item/);
  assert.match(reply, /Dividir um item entre destinos diferentes/);
  assert.match(reply, /Não controlar algum item no estoque/);
  assert.match(reply, /Carne bovina Premium — 10 kg/);
});

test('explicit inventory intent bypasses receiving guidance and keeps confirmation flow', () => {
  const observed = '10 KG Carne bovina Premium';
  assert.equal(
    shouldGuidePurchaseIntake(
      'Atualize meu estoque com esta nota fiscal.',
      observed
    ),
    false
  );
  assert.equal(
    shouldGuidePurchaseIntake(
      'Transforme os itens desta nota fiscal.',
      observed
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

test('follow-up mutation can reuse the latest attachment without requiring re-upload', () => {
  assert.equal(
    isKyrubInventoryAttachmentIntakeIntent(
      'Agora atualize o estoque com essa nota.'
    ),
    true
  );
  assert.match(multimodalClient, /latestAttachmentMessage/);
  assert.match(multimodalClient, /latestUserMessage/);
  assert.match(
    multimodalClient,
    /buildKyrubInventoryAttachmentIntakeProposal\(\s*intentMessage\.content/
  );
  assert.match(
    multimodalClient,
    /attachmentMessage\.attachments/
  );
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
  assert.match(multimodalClient, /buildGuidedPurchaseIntakeReply/);
  assert.match(multimodalClient, /shouldGuidePurchaseIntake/);
  assert.match(multimodalClient, /emitKyrubAiActionProposal/);
  assert.doesNotMatch(multimodalClient, /firebase\/firestore|setDoc\(|updateDoc\(|runTransaction\(/);
});

test('exact inventory adjustment identity is optional for legacy intake but authoritative when supplied', () => {
  const extension = readFileSync('shared/exactInventoryAdjustment.ts', 'utf8');
  const executor = readFileSync('server/actions/inventoryAdjustmentExecutionService.ts', 'utf8');

  assert.match(extension, /inventoryItemId\?: string/);
  assert.match(extension, /\^\[a-zA-Z0-9_-\]\{1,180\}\$/);

  assert.match(executor, /normalizeExactInventoryItemId\(value\.inventoryItemId\)/);
  assert.match(executor, /exactInventoryItemId\s*\?\s*catalog\.findIndex\(item => item\.id === exactInventoryItemId\)/);
  assert.match(executor, /INVENTORY_ITEM_ID_NOT_FOUND/);
  assert.match(executor, /Nenhum item será escolhido por nome/);
  assert.match(executor, /INVENTORY_ITEM_IDENTITY_MISMATCH/);
  assert.match(executor, /normalizeName\(existing\.name\) !== normalizeName\(entry\.name\)/);

  assert.match(executor, /: catalog\.findIndex\(item => `\$\{normalizeName\(item\.name\)\}::\$\{item\.unit\}` === key\)/);
  assert.match(executor, /if \(existingIndex < 0\) \{\n        if \(proposal\.mode !== 'increment'\)/);
  assert.match(executor, /const itemId = deterministicItemId\(actor\.uid, entry\)/);
});

test('manual physical inventory UI prepares exact proposals and still requires the existing confirmation bridge', () => {
  const manual = readFileSync('src/utils/manualPhysicalInventoryAdjustment.ts', 'utf8');
  const workspace = readFileSync('src/components/store/PhysicalInventoryWorkspace.tsx', 'utf8');
  const bridge = readFileSync('src/components/KyrubAiInventoryActionBridge.tsx', 'utf8');
  const executor = readFileSync('server/actions/inventoryAdjustmentExecutionService.ts', 'utf8');

  assert.match(manual, /inventoryItemId: itemId/);
  assert.match(manual, /origin: 'manual'/);
  assert.match(manual, /mode: input\.mode/);
  assert.match(manual, /requiresConfirmation: true/);
  assert.match(manual, /KYRUB_AI_ACTION_PROPOSAL_EVENT/);
  assert.match(manual, /window\.dispatchEvent/);
  assert.doesNotMatch(manual, /executeKyrubAction|\/api\/action-execute|firebase\/firestore|setDoc\(|updateDoc\(/);

  assert.match(workspace, /Dar entrada/);
  assert.match(workspace, /Corrigir contagem/);
  assert.match(workspace, /Revisar ajuste/);
  assert.match(workspace, /requestManualPhysicalInventoryAdjustment/);
  assert.match(workspace, /O clique acima não altera o estoque/);
  assert.doesNotMatch(workspace, /executeKyrubAction|\/api\/action-execute|setDoc\(|updateDoc\(/);

  assert.match(bridge, /detail\.proposal\.type === 'adjust_inventory'/);
  assert.match(bridge, /executeKyrubAction\(user, current\.proposal, true\)/);

  assert.match(executor, /const origin = proposal\.origin \?\? 'kyrubia'/);
  assert.match(executor, /origin,\n      lines: movementLines/);
  assert.match(executor, /origin,\n      inputProvenance:/);
  assert.match(executor, /idempotencyKey: proposal\.idempotencyKey \?\?/);
});
