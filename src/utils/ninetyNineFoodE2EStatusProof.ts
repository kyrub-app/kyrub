import type { User } from 'firebase/auth';
import {
  loadNinetyNineFoodPendingStatusSyncs,
  type NinetyNineFoodPendingStatusSyncItem,
} from './ninetyNineFoodPendingStatusSync';
import {
  readOmnichannelE2EEvidence,
  type OmnichannelE2EEvidenceRecord,
} from './omnichannelE2EEvidence';
import type { NinetyNineFoodE2ETestSubject } from './ninetyNineFoodE2ETestSubject';

export type NinetyNineFoodE2EProofState =
  | 'waiting'
  | 'proven'
  | 'attention'
  | 'blocked';

export interface NinetyNineFoodE2EProofStep {
  state: NinetyNineFoodE2EProofState;
  status: string;
  source: string;
  observedAt: string;
  orderRevision: string;
  executionId: string;
  note: string;
}

export interface NinetyNineFoodE2EStatusProofSnapshot {
  orderId: string;
  externalOrderId: string;
  observedAt: string;
  kyrubOnly: NinetyNineFoodE2EProofStep;
  manualSync: NinetyNineFoodE2EProofStep;
  nextDirectSync: NinetyNineFoodE2EProofStep;
  warnings: string[];
}

const emptyStep = (note: string): NinetyNineFoodE2EProofStep => ({
  state: 'waiting',
  status: '',
  source: '',
  observedAt: '',
  orderRevision: '',
  executionId: '',
  note,
});

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const millis = (value: string): number | null => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const detailString = (
  record: OmnichannelE2EEvidenceRecord,
  key: string
): string => clean(record.details[key]);

const detailIsFalse = (
  record: OmnichannelE2EEvidenceRecord,
  key: string
): boolean => record.details[key] === false;

const after = (record: OmnichannelE2EEvidenceRecord, instant: string): boolean => {
  const recordMillis = millis(record.observedAt);
  const instantMillis = millis(instant);
  return recordMillis !== null && instantMillis !== null && recordMillis >= instantMillis;
};

const laterThan = (record: OmnichannelE2EEvidenceRecord, instant: string): boolean => {
  const recordMillis = millis(record.observedAt);
  const instantMillis = millis(instant);
  return recordMillis !== null && instantMillis !== null && recordMillis > instantMillis;
};

const orderEvidence = (
  records: OmnichannelE2EEvidenceRecord[],
  subject: NinetyNineFoodE2ETestSubject
): OmnichannelE2EEvidenceRecord[] =>
  records.filter(record =>
    after(record, subject.selectedAt) &&
    detailString(record, 'orderId') === subject.orderId
  );

const exactPending = (
  items: NinetyNineFoodPendingStatusSyncItem[],
  subject: NinetyNineFoodE2ETestSubject
): NinetyNineFoodPendingStatusSyncItem | null =>
  items.find(item =>
    item.orderId === subject.orderId &&
    item.externalOrderId === subject.externalOrderId
  ) ?? null;

const decisionStatus = (record: OmnichannelE2EEvidenceRecord | null): string =>
  record ? detailString(record, 'status') : '';

export const loadNinetyNineFoodE2EStatusProof = async (
  user: User,
  subject: NinetyNineFoodE2ETestSubject
): Promise<NinetyNineFoodE2EStatusProofSnapshot> => {
  if (user.uid !== subject.storeId) {
    throw new Error('A cobaia E2E não pertence ao owner autenticado.');
  }

  const pendingItems = await loadNinetyNineFoodPendingStatusSyncs(user);
  const records = orderEvidence(
    readOmnichannelE2EEvidence(subject.storeId),
    subject
  );
  const pending = exactPending(pendingItems, subject);
  const decisions = records.filter(record => record.kind === '99food_status_decision');
  const manualRecords = records.filter(record => record.kind === '99food_manual_status_sync');
  const kyrubOnlyRecords = decisions.filter(
    record => record.outcome === 'authorization-required'
  );

  const kyrubOnlyEvidence = kyrubOnlyRecords[0] ?? null;
  const kyrubOnlyStatus = decisionStatus(kyrubOnlyEvidence) ||
    (pending?.outboundStatus === 'authorization_required' ? pending.status : '');

  let kyrubOnly = emptyStep(
    'Faça uma transição no KDS e escolha “Atualizar só no Kyrub”; depois reconsulte esta prova.'
  );
  if (kyrubOnlyEvidence || pending?.outboundStatus === 'authorization_required') {
    kyrubOnly = {
      state: 'proven',
      status: kyrubOnlyStatus,
      source: pending?.outboundStatus === 'authorization_required'
        ? 'authoritative_pending_queue'
        : 'authoritative_execution_result',
      observedAt: kyrubOnlyEvidence?.observedAt ?? pending?.outboundUpdatedAt ?? '',
      orderRevision: pending?.status === kyrubOnlyStatus ? pending.orderRevision : '',
      executionId: '',
      note: pending?.status === kyrubOnlyStatus
        ? 'Kyrub-only observado e a fila manual expõe a revisão exata atualmente autorizável.'
        : 'Kyrub-only observado nesta sessão; a fila manual atual já não expõe a mesma revisão.'
    };
  } else if (pending?.outboundStatus === 'attention') {
    kyrubOnly = {
      state: 'attention',
      status: pending.status,
      source: 'authoritative_pending_queue',
      observedAt: pending.outboundUpdatedAt,
      orderRevision: pending.orderRevision,
      executionId: '',
      note: 'Há uma pendência 99Food em atenção, mas não há prova desta sessão de que ela nasceu do ramo Kyrub-only.'
    };
  }

  const multipleManualSyncs = manualRecords.length > 1;
  const manualEvidence = manualRecords.length === 1 ? manualRecords[0] : null;
  let manualSync = emptyStep(
    'Depois de provar Kyrub-only, use a fila manual padrão para autorizar o envio da revisão exata. Este observador não envia nada.'
  );
  if (multipleManualSyncs) {
    manualSync = {
      state: 'blocked',
      status: '',
      source: 'session_evidence_conflict',
      observedAt: '',
      orderRevision: '',
      executionId: '',
      note: 'Mais de um envio manual foi observado para esta cobaia na mesma sessão. O roteiro deixou de ser unívoco; não escolha automaticamente um deles.'
    };
  } else if (manualEvidence) {
    const noLocalReplay = detailIsFalse(manualEvidence, 'localTransitionApplied');
    const outcome = manualEvidence.outcome;
    const manualStatus = detailString(manualEvidence, 'status');
    const state: NinetyNineFoodE2EProofState =
      outcome === 'sent' && noLocalReplay
        ? 'proven'
        : outcome === 'reconciliation_required' || outcome === 'attention'
          ? 'attention'
          : 'blocked';
    manualSync = {
      state,
      status: manualStatus,
      source: 'authoritative_execution_result',
      observedAt: manualEvidence.observedAt,
      orderRevision: detailString(manualEvidence, 'orderRevision'),
      executionId: detailString(manualEvidence, 'executionId'),
      note: state === 'proven'
        ? 'Envio manual aceito com localTransitionApplied = false; a transição local não foi repetida.'
        : state === 'attention'
          ? 'O envio manual ficou ambíguo/em atenção. Pare e reconcilie; não faça uma nova tentativa automática.'
          : 'A evidência do envio manual não contém localTransitionApplied = false de forma explícita.'
    };
  }

  const manualAt = manualEvidence?.observedAt ?? '';
  const manualStatus = manualEvidence ? detailString(manualEvidence, 'status') : '';
  const directEvidence = manualEvidence && manualSync.state === 'proven'
    ? decisions.find(record =>
        laterThan(record, manualAt) &&
        (record.outcome === 'sent' || record.outcome === 'attention') &&
        detailString(record, 'status') !== manualStatus
      ) ?? null
    : null;

  let nextDirectSync = emptyStep(
    'Após o envio manual concluído, faça uma transição seguinte no KDS e escolha “Kyrub + 99Food” com autorização nova para esse novo status.'
  );
  if (directEvidence) {
    nextDirectSync = {
      state: directEvidence.outcome === 'sent' ? 'proven' : 'attention',
      status: detailString(directEvidence, 'status'),
      source: 'authoritative_execution_result',
      observedAt: directEvidence.observedAt,
      orderRevision: '',
      executionId: '',
      note: directEvidence.outcome === 'sent'
        ? 'Uma transição posterior e diferente foi aplicada no Kyrub e enviada à 99Food com a autoridade daquele status.'
        : 'A transição posterior tentou o provider, mas ficou em atenção; reconcilie antes de avançar.'
    };
  }

  const warnings: string[] = [];
  if (multipleManualSyncs) {
    warnings.push('Mais de um envio manual foi observado para a cobaia. Pare o E2E e reinicie a janela com um novo pedido para obter uma sequência unívoca.');
  }
  if (kyrubOnlyRecords.length > 1 && !manualEvidence) {
    warnings.push('Mais de uma decisão Kyrub-only foi observada antes do único envio manual esperado. Não trate a sequência como limpa.');
  }
  const directBeforeManual = decisions.find(record =>
    (record.outcome === 'sent' || record.outcome === 'attention') &&
    (!manualEvidence || !laterThan(record, manualEvidence.observedAt))
  );
  if (directBeforeManual) {
    warnings.push(
      `Foi observada uma decisão ${directBeforeManual.outcome} para ${detailString(directBeforeManual, 'status')} antes da prova do envio manual; não conte isso como a transição final do roteiro.`
    );
  }
  const secondKyrubOnly = manualEvidence
    ? decisions.find(record =>
        record.outcome === 'authorization-required' &&
        laterThan(record, manualEvidence.observedAt) &&
        detailString(record, 'status') !== manualStatus
      )
    : null;
  if (secondKyrubOnly) {
    warnings.push(
      `A transição seguinte (${detailString(secondKyrubOnly, 'status')}) também foi Kyrub-only; ainda falta provar uma autorização Kyrub + 99Food nova.`
    );
  }
  if (manualEvidence && !detailIsFalse(manualEvidence, 'localTransitionApplied')) {
    warnings.push('A resposta do envio manual não provou localTransitionApplied = false. Pare o E2E.');
  }

  return {
    orderId: subject.orderId,
    externalOrderId: subject.externalOrderId,
    observedAt: new Date().toISOString(),
    kyrubOnly,
    manualSync,
    nextDirectSync,
    warnings,
  };
};
