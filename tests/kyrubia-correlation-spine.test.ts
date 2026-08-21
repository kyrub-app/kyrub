import assert from 'node:assert/strict';
import test from 'node:test';
import type { KyrubAiCreateNoteProposal } from '../shared/kyrubActions';
import { buildKyrubActionPreview } from '../server/actions/actionProposalPreview';
import { buildKyrubPreviewAuthorization } from '../server/actions/previewAuthorization';
import {
  appendExecutionCorrelationLinks,
  deterministicKyrubCorrelationId,
  linksForPreviewAuthorization,
} from '../server/actions/correlationSpine';

const proposal: KyrubAiCreateNoteProposal = {
  id: 'proposal-corr-1',
  type: 'create_note',
  title: 'Nota',
  content: 'Conteúdo',
  checklist: [],
  requiresConfirmation: true,
  origin: 'kyrubia',
  risk: 'low',
  inputProvenance: 'user_intent',
  impact: { entityCount: 1, reversibility: 'easy' },
};

test('correlation ids are deterministic for the same actor/action/seed', () => {
  const first = deterministicKyrubCorrelationId({
    actorUid: 'user-1', actionType: 'create_note', seed: 'message-1',
  });
  const second = deterministicKyrubCorrelationId({
    actorUid: 'user-1', actionType: 'create_note', seed: 'message-1',
  });
  assert.equal(first, second);
});

test('preview, authorization, execution, receipt and event share one correlation spine', () => {
  const correlationId = deterministicKyrubCorrelationId({
    actorUid: 'user-1', actionType: 'create_note', seed: 'message-1',
  });
  const preview = buildKyrubActionPreview({
    proposal,
    correlationId,
    title: 'Criar nota',
    summary: 'Criar uma nota.',
    now: new Date('2026-08-21T13:00:00.000Z'),
  });
  const authorization = buildKyrubPreviewAuthorization({
    preview,
    actorUid: 'user-1',
    confirmedPreviewId: preview.previewId,
    confirmedProposalHash: preview.proposalHash,
    now: new Date('2026-08-21T13:01:00.000Z'),
  });
  const firstLinks = linksForPreviewAuthorization({
    actorUid: 'user-1', preview, authorization,
  });
  const links = appendExecutionCorrelationLinks({
    existing: firstLinks,
    actorUid: 'user-1',
    correlationId,
    actionType: 'create_note',
    executionId: 'exec_1',
    receiptId: 'receipt_1',
    domainEventId: 'event_1',
    occurredAt: '2026-08-21T13:01:30.000Z',
  });

  assert.equal(links.length, 5);
  assert.deepEqual(
    links.map(link => link.stage),
    ['preview', 'authorization', 'execution', 'receipt', 'domain_event']
  );
  assert.ok(links.every(link => link.correlationId === correlationId));
});

test('chain rejects actor mismatch instead of silently stitching traces', () => {
  const correlationId = deterministicKyrubCorrelationId({
    actorUid: 'user-1', actionType: 'create_note', seed: 'message-2',
  });
  const preview = buildKyrubActionPreview({
    proposal,
    correlationId,
    title: 'Criar nota',
    summary: 'Criar uma nota.',
  });
  const authorization = buildKyrubPreviewAuthorization({
    preview,
    actorUid: 'user-1',
    confirmedPreviewId: preview.previewId,
    confirmedProposalHash: preview.proposalHash,
  });
  const links = linksForPreviewAuthorization({ actorUid: 'user-1', preview, authorization });

  assert.throws(
    () => appendExecutionCorrelationLinks({
      existing: links,
      actorUid: 'user-2',
      correlationId,
      actionType: 'create_note',
      executionId: 'exec_2',
      receiptId: 'receipt_2',
    }),
    /CORRELATION_ACTOR_MISMATCH/
  );
});
