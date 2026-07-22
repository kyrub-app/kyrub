import type { User } from 'firebase/auth';
import {
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type DocumentData,
  type Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import type { CanonicalReadConfig } from './canonicalReadCutover';
import type {
  MigrationReconciliationReport,
  ReconciliationSectionKey,
} from './migrationReconciliation';

export const MIGRATION_COMPLETION_CHECK_KEYS = [
  'products_flow',
  'orders_flow',
  'payments_flow',
  'cash_flow',
  'fallback_flow',
  'reconciliation_after_tests',
] as const;

export type MigrationCompletionCheckKey =
  (typeof MIGRATION_COMPLETION_CHECK_KEYS)[number];

export type MigrationCompletionChecklist = Record<
  MigrationCompletionCheckKey,
  boolean
>;

export interface MigrationCompletionGateState {
  canonicalStoreId: string;
  checklist: MigrationCompletionChecklist;
  notes: string;
  confirmedByUserId: string;
  confirmedAt: string;
  confirmedReconciliationSignature: string;
  updatedAt: string;
}

export interface MigrationCompletionReadiness {
  ready: boolean;
  confirmed: boolean;
  blockers: string[];
  reconciliationSignature: string;
}

export const DEFAULT_MIGRATION_COMPLETION_CHECKLIST: MigrationCompletionChecklist = {
  products_flow: false,
  orders_flow: false,
  payments_flow: false,
  cash_flow: false,
  fallback_flow: false,
  reconciliation_after_tests: false,
};

export const DEFAULT_MIGRATION_COMPLETION_GATE: MigrationCompletionGateState = {
  canonicalStoreId: '',
  checklist: { ...DEFAULT_MIGRATION_COMPLETION_CHECKLIST },
  notes: '',
  confirmedByUserId: '',
  confirmedAt: '',
  confirmedReconciliationSignature: '',
  updatedAt: '',
};

const cleanString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const timestampToIso = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'toDate' in value) {
    return (value as Timestamp).toDate().toISOString();
  }
  return '';
};

const cleanNotes = (value: string): string => {
  const notes = value.trim();
  if (notes.length > 1000) {
    throw new Error('A observação da validação deve ter no máximo 1000 caracteres.');
  }
  return notes;
};

const parseChecklist = (value: unknown): MigrationCompletionChecklist => {
  const candidate =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};

  return MIGRATION_COMPLETION_CHECK_KEYS.reduce<MigrationCompletionChecklist>(
    (checklist, key) => {
      checklist[key] = candidate[key] === true;
      return checklist;
    },
    { ...DEFAULT_MIGRATION_COMPLETION_CHECKLIST }
  );
};

export const parseMigrationCompletionGate = (
  value: DocumentData | undefined
): MigrationCompletionGateState => {
  const rawGate =
    value?.migrationCompletionGate &&
    typeof value.migrationCompletionGate === 'object'
      ? (value.migrationCompletionGate as Record<string, unknown>)
      : {};

  return {
    canonicalStoreId: cleanString(rawGate.canonicalStoreId),
    checklist: parseChecklist(rawGate.checklist),
    notes: cleanString(rawGate.notes),
    confirmedByUserId: cleanString(rawGate.confirmedByUserId),
    confirmedAt: timestampToIso(rawGate.confirmedAt),
    confirmedReconciliationSignature: cleanString(
      rawGate.confirmedReconciliationSignature
    ),
    updatedAt: timestampToIso(rawGate.updatedAt),
  };
};

export const buildReconciliationReadinessSignature = (
  report: MigrationReconciliationReport
): string =>
  JSON.stringify({
    canonicalStoreId: report.store.id,
    legacyStoreId: report.legacyStoreId,
    sections: [...report.sections]
      .sort((left, right) => left.key.localeCompare(right.key))
      .map(section => ({
        key: section.key,
        status: section.status,
        issues: section.issues.map(issue => ({
          entityId: issue.entityId,
          message: issue.message,
        })),
      })),
  });

const sectionMatched = (
  report: MigrationReconciliationReport,
  key: ReconciliationSectionKey
): boolean => report.sections.find(section => section.key === key)?.status === 'matched';

export const allMigrationCompletionChecksDone = (
  checklist: MigrationCompletionChecklist
): boolean =>
  MIGRATION_COMPLETION_CHECK_KEYS.every(key => checklist[key] === true);

export const getMigrationCompletionPrerequisiteError = (
  key: MigrationCompletionCheckKey,
  report: MigrationReconciliationReport,
  readConfig: CanonicalReadConfig
): string => {
  if (key === 'products_flow') {
    if (!sectionMatched(report, 'products')) {
      return 'Conclua a reconciliação de produtos antes de validar este fluxo.';
    }
    if (!readConfig.preferences.products) {
      return 'Ative a leitura canônica de produtos antes do teste real.';
    }
  }

  if (key === 'orders_flow') {
    if (!sectionMatched(report, 'orders')) {
      return 'Conclua a reconciliação de pedidos antes de validar este fluxo.';
    }
    if (!readConfig.preferences.orders) {
      return 'Ative a leitura canônica de pedidos antes do teste real.';
    }
  }

  if (key === 'payments_flow') {
    if (!sectionMatched(report, 'payments')) {
      return 'Conclua a reconciliação de pagamentos antes de validar este fluxo.';
    }
    if (!readConfig.preferences.payments) {
      return 'Ative a leitura canônica de pagamentos antes do teste real.';
    }
  }

  if (key === 'cash_flow' && !sectionMatched(report, 'cash')) {
    return 'Conclua a reconciliação do caixa antes de validar este fluxo.';
  }

  if (key === 'fallback_flow') {
    const allReadDomainsEnabled =
      readConfig.preferences.products &&
      readConfig.preferences.orders &&
      readConfig.preferences.payments;
    if (!allReadDomainsEnabled) {
      return 'Ative os três domínios canônicos antes de validar o fallback.';
    }
    if (!report.readyForCanonicalRead) {
      return 'Todos os domínios precisam estar alinhados para validar o fallback.';
    }
  }

  if (
    key === 'reconciliation_after_tests' &&
    !report.readyForCanonicalRead
  ) {
    return 'Execute novamente a conferência e corrija todas as divergências.';
  }

  return '';
};

export const getMigrationCompletionReadiness = (
  report: MigrationReconciliationReport,
  readConfig: CanonicalReadConfig,
  gate: MigrationCompletionGateState
): MigrationCompletionReadiness => {
  const blockers: string[] = [];
  const reconciliationSignature = buildReconciliationReadinessSignature(report);

  if (!report.readyForCanonicalRead) {
    blockers.push('A reconciliação ainda possui divergências ou áreas indisponíveis.');
  }

  if (readConfig.canonicalStoreId !== report.store.id) {
    blockers.push('O mapeamento da loja canônica não corresponde à conferência atual.');
  }

  if (!readConfig.preferences.products) {
    blockers.push('A leitura canônica de produtos ainda não está ativa.');
  }
  if (!readConfig.preferences.orders) {
    blockers.push('A leitura canônica de pedidos ainda não está ativa.');
  }
  if (!readConfig.preferences.payments) {
    blockers.push('A leitura canônica de pagamentos ainda não está ativa.');
  }

  if (gate.canonicalStoreId && gate.canonicalStoreId !== report.store.id) {
    blockers.push('O checklist salvo pertence a outro mapeamento canônico.');
  }

  if (!allMigrationCompletionChecksDone(gate.checklist)) {
    blockers.push('Todos os testes reais do checklist precisam ser confirmados.');
  }

  const ready = blockers.length === 0;
  const confirmed =
    ready &&
    gate.confirmedByUserId === report.store.ownerId &&
    Boolean(gate.confirmedAt) &&
    gate.confirmedReconciliationSignature === reconciliationSignature;

  return { ready, confirmed, blockers, reconciliationSignature };
};

const assertOwnerContext = (
  user: Pick<User, 'uid'>,
  report: MigrationReconciliationReport
): void => {
  if (
    !user.uid ||
    user.uid !== report.legacyStoreId ||
    report.store.ownerId !== user.uid
  ) {
    throw new Error('Somente o proprietário pode validar o encerramento da migração.');
  }
};

const writeGate = async (
  legacyStoreId: string,
  gate: Omit<MigrationCompletionGateState, 'updatedAt'> & {
    updatedAt: ReturnType<typeof serverTimestamp>;
    confirmedAt: string | ReturnType<typeof serverTimestamp>;
  }
): Promise<void> => {
  await setDoc(
    doc(db, 'tenants', legacyStoreId),
    { migrationCompletionGate: gate },
    { merge: true }
  );
};

export const subscribeToMigrationCompletionGate = (
  legacyStoreId: string,
  onGate: (gate: MigrationCompletionGateState) => void,
  onError?: (error: Error) => void
): Unsubscribe => {
  const normalizedStoreId = legacyStoreId.trim();
  if (!normalizedStoreId) {
    onGate({ ...DEFAULT_MIGRATION_COMPLETION_GATE });
    return () => undefined;
  }

  return onSnapshot(
    doc(db, 'tenants', normalizedStoreId),
    snapshot => onGate(parseMigrationCompletionGate(snapshot.data())),
    error => {
      onGate({ ...DEFAULT_MIGRATION_COMPLETION_GATE });
      onError?.(error);
    }
  );
};

export const updateMigrationCompletionCheck = async (
  user: Pick<User, 'uid'>,
  report: MigrationReconciliationReport,
  readConfig: CanonicalReadConfig,
  currentGate: MigrationCompletionGateState,
  key: MigrationCompletionCheckKey,
  checked: boolean
): Promise<void> => {
  assertOwnerContext(user, report);
  if (checked) {
    const prerequisiteError = getMigrationCompletionPrerequisiteError(
      key,
      report,
      readConfig
    );
    if (prerequisiteError) throw new Error(prerequisiteError);
  }

  await writeGate(report.legacyStoreId, {
    canonicalStoreId: report.store.id,
    checklist: { ...currentGate.checklist, [key]: checked },
    notes: cleanNotes(currentGate.notes),
    confirmedByUserId: '',
    confirmedAt: '',
    confirmedReconciliationSignature: '',
    updatedAt: serverTimestamp(),
  });
};

export const updateMigrationCompletionNotes = async (
  user: Pick<User, 'uid'>,
  report: MigrationReconciliationReport,
  currentGate: MigrationCompletionGateState,
  notes: string
): Promise<void> => {
  assertOwnerContext(user, report);
  await writeGate(report.legacyStoreId, {
    canonicalStoreId: report.store.id,
    checklist: { ...currentGate.checklist },
    notes: cleanNotes(notes),
    confirmedByUserId: '',
    confirmedAt: '',
    confirmedReconciliationSignature: '',
    updatedAt: serverTimestamp(),
  });
};

export const confirmMigrationCompletionCandidate = async (
  user: Pick<User, 'uid'>,
  report: MigrationReconciliationReport,
  readConfig: CanonicalReadConfig,
  currentGate: MigrationCompletionGateState
): Promise<void> => {
  assertOwnerContext(user, report);
  const readiness = getMigrationCompletionReadiness(report, readConfig, currentGate);
  if (!readiness.ready) {
    throw new Error(readiness.blockers[0] || 'A migração ainda não pode ser finalizada.');
  }

  await writeGate(report.legacyStoreId, {
    canonicalStoreId: report.store.id,
    checklist: { ...currentGate.checklist },
    notes: cleanNotes(currentGate.notes),
    confirmedByUserId: user.uid,
    confirmedAt: serverTimestamp(),
    confirmedReconciliationSignature: readiness.reconciliationSignature,
    updatedAt: serverTimestamp(),
  });
};

export const revokeMigrationCompletionCandidate = async (
  user: Pick<User, 'uid'>,
  report: MigrationReconciliationReport,
  currentGate: MigrationCompletionGateState
): Promise<void> => {
  assertOwnerContext(user, report);
  await writeGate(report.legacyStoreId, {
    canonicalStoreId: report.store.id,
    checklist: { ...currentGate.checklist },
    notes: cleanNotes(currentGate.notes),
    confirmedByUserId: '',
    confirmedAt: '',
    confirmedReconciliationSignature: '',
    updatedAt: serverTimestamp(),
  });
};
