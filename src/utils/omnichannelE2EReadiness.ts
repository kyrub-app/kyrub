import type { User } from 'firebase/auth';
import { getNinetyNineFoodConnectionStatus } from './ninetyNineFoodIntegration';
import { loadNinetyNineFoodPendingStatusSyncs } from './ninetyNineFoodPendingStatusSync';
import { loadNinetyNineFoodStatusSyncReconciliationItems } from './ninetyNineFoodStatusSyncReconciliation';
import { loadStoreChannelOperationalQueue } from './storeChannelOperations';
import { loadStoreConnectionOnboarding } from './storeConnections';
import { loadStoreInventoryAuthorityHealth } from './storeInventoryAuthorityHealth';

export type OmnichannelE2EGateState = 'ready' | 'attention' | 'blocked' | 'unknown';
export type OmnichannelE2EOverallState = 'ready' | 'attention' | 'blocked' | 'partial';

export interface OmnichannelE2EGate {
  id:
    | 'inventory_authority'
    | 'mercado_livre_connection'
    | '99food_connection'
    | 'operational_queue'
    | '99food_pending_status_sync'
    | '99food_reconciliation';
  label: string;
  state: OmnichannelE2EGateState;
  detail: string;
}

export interface OmnichannelE2EReadiness {
  storeId: string;
  checkedAt: string;
  overall: OmnichannelE2EOverallState;
  gates: OmnichannelE2EGate[];
  sourceErrors: string[];
  mercadoLivre: {
    connected: boolean;
    connectionStatus: string;
    operationalItems: number;
  };
  ninetyNineFood: {
    connected: boolean;
    adapterStatus: string;
    registryStatus: string;
    operationalItems: number;
    pendingStatusSyncs: number;
    reconciliations: number;
  };
}

const unique = (values: string[]): string[] => Array.from(new Set(values));

const gate = (
  id: OmnichannelE2EGate['id'],
  label: string,
  state: OmnichannelE2EGateState,
  detail: string
): OmnichannelE2EGate => ({ id, label, state, detail });

export const loadOmnichannelE2EReadiness = async (
  user: User,
  storeIdValue: string
): Promise<OmnichannelE2EReadiness> => {
  const storeId = storeIdValue.trim();
  if (!storeId || user.uid !== storeId) {
    throw new Error('A prontidão E2E só pode ser consultada pelo owner da loja autenticada.');
  }

  const [
    onboardingResult,
    authorityResult,
    ninetyNineFoodStatusResult,
    queueResult,
    pendingStatusResult,
    reconciliationResult,
  ] = await Promise.allSettled([
    loadStoreConnectionOnboarding(user, storeId),
    loadStoreInventoryAuthorityHealth(user, storeId),
    getNinetyNineFoodConnectionStatus(),
    loadStoreChannelOperationalQueue(user, storeId),
    loadNinetyNineFoodPendingStatusSyncs(user),
    loadNinetyNineFoodStatusSyncReconciliationItems(user),
  ]);

  const sourceErrors: string[] = [];
  if (onboardingResult.status === 'rejected') sourceErrors.push('connection_registry');
  if (authorityResult.status === 'rejected') sourceErrors.push('inventory_authority');
  if (ninetyNineFoodStatusResult.status === 'rejected') sourceErrors.push('99food_adapter_status');
  if (queueResult.status === 'rejected') sourceErrors.push('operational_queue');
  if (pendingStatusResult.status === 'rejected') sourceErrors.push('99food_pending_status_sync');
  if (reconciliationResult.status === 'rejected') sourceErrors.push('99food_reconciliation');
  if (queueResult.status === 'fulfilled') {
    sourceErrors.push(...queueResult.value.sourceErrors.map(source => `operational:${source}`));
  }

  const onboarding = onboardingResult.status === 'fulfilled' ? onboardingResult.value : null;
  const authority = authorityResult.status === 'fulfilled' ? authorityResult.value : null;
  const ninetyNineFoodStatus = ninetyNineFoodStatusResult.status === 'fulfilled'
    ? ninetyNineFoodStatusResult.value
    : null;
  const operationalItems = queueResult.status === 'fulfilled' ? queueResult.value.items : [];
  const pendingStatusSyncs = pendingStatusResult.status === 'fulfilled'
    ? pendingStatusResult.value
    : [];
  const reconciliations = reconciliationResult.status === 'fulfilled'
    ? reconciliationResult.value
    : [];

  const mercadoLivreConnection = onboarding?.connections.find(connection =>
    connection.channel === 'mercado_livre'
  ) ?? null;
  const ninetyNineFoodRegistryConnection = onboarding?.connections.find(connection =>
    connection.channel === '99food'
  ) ?? null;
  const mercadoLivreConnected = mercadoLivreConnection?.status === 'connected';
  const ninetyNineFoodAdapterConnected = ninetyNineFoodStatus?.status === 'connected';
  const ninetyNineFoodRegistryConnected = ninetyNineFoodRegistryConnection?.status === 'connected';
  const ninetyNineFoodConnected = Boolean(
    ninetyNineFoodAdapterConnected && ninetyNineFoodRegistryConnected
  );

  const mercadoLivreOperationalItems = operationalItems.filter(item =>
    item.provider === 'mercado_livre'
  ).length;
  const ninetyNineFoodOperationalItems = operationalItems.filter(item =>
    item.provider === '99food'
  ).length;

  const gates: OmnichannelE2EGate[] = [];
  gates.push(
    authority === null
      ? gate(
          'inventory_authority',
          'Autoridade canônica de estoque',
          'unknown',
          'A leitura de autoridade física não ficou disponível; o E2E não deve inferir owner ou inventário.'
        )
      : authority.state === 'resolved'
        ? gate(
            'inventory_authority',
            'Autoridade canônica de estoque',
            'ready',
            'Owner canônico e inventário físico estão resolvidos para testes de ATP/reserva.'
          )
        : gate(
            'inventory_authority',
            'Autoridade canônica de estoque',
            'blocked',
            `A autoridade física está em ${authority.state}; corrija essa governança antes de usar ATP no E2E.`
          )
  );

  gates.push(
    onboarding === null
      ? gate(
          'mercado_livre_connection',
          'Conexão Mercado Livre',
          'unknown',
          'O registro de conexões da loja não ficou disponível nesta leitura.'
        )
      : mercadoLivreConnected
        ? gate(
            'mercado_livre_connection',
            'Conexão Mercado Livre',
            'ready',
            'A conexão autoritativa do Mercado Livre está ativa.'
          )
        : gate(
            'mercado_livre_connection',
            'Conexão Mercado Livre',
            'blocked',
            `A conexão Mercado Livre está ${mercadoLivreConnection?.status ?? 'ausente'}.`
          )
  );

  gates.push(
    onboarding === null || ninetyNineFoodStatus === null
      ? gate(
          '99food_connection',
          'Conexão 99Food',
          'unknown',
          'Não foi possível cruzar o adapter 99Food com o registro autoritativo de canais.'
        )
      : ninetyNineFoodConnected
        ? gate(
            '99food_connection',
            'Conexão 99Food',
            'ready',
            'Adapter e registro da loja concordam que a 99Food está conectada.'
          )
        : ninetyNineFoodAdapterConnected || ninetyNineFoodRegistryConnected
          ? gate(
              '99food_connection',
              'Conexão 99Food',
              'attention',
              `Há divergência entre adapter (${ninetyNineFoodStatus.status}) e registro (${ninetyNineFoodRegistryConnection?.status ?? 'ausente'}).`
            )
          : gate(
              '99food_connection',
              'Conexão 99Food',
              'blocked',
              `A 99Food não está conectada no adapter/registro (${ninetyNineFoodStatus.status} / ${ninetyNineFoodRegistryConnection?.status ?? 'ausente'}).`
            )
  );

  gates.push(
    queueResult.status === 'rejected' || queueResult.value.sourceErrors.length > 0
      ? gate(
          'operational_queue',
          'Pendências operacionais dos canais',
          'unknown',
          'A fila está parcial; ausência de itens não pode ser interpretada como ausência de pendências.'
        )
      : operationalItems.length > 0
        ? gate(
            'operational_queue',
            'Pendências operacionais dos canais',
            'attention',
            `${operationalItems.length} pendência(s) autoritativa(s) já existem e podem contaminar a leitura de um novo teste.`
          )
        : gate(
            'operational_queue',
            'Pendências operacionais dos canais',
            'ready',
            'Nenhuma pendência operacional pré-existente apareceu nesta leitura.'
          )
  );

  gates.push(
    pendingStatusResult.status === 'rejected'
      ? gate(
          '99food_pending_status_sync',
          'Status 99Food aguardando autorização',
          'unknown',
          'A fila de status manual 99Food não ficou disponível.'
        )
      : pendingStatusSyncs.length > 0
        ? gate(
            '99food_pending_status_sync',
            'Status 99Food aguardando autorização',
            'attention',
            `${pendingStatusSyncs.length} envio(s) manual(is) de status aguardam decisão explícita.`
          )
        : gate(
            '99food_pending_status_sync',
            'Status 99Food aguardando autorização',
            'ready',
            'Não há envio manual de status pendente nesta leitura.'
          )
  );

  gates.push(
    reconciliationResult.status === 'rejected'
      ? gate(
          '99food_reconciliation',
          'Reconciliação 99Food',
          'unknown',
          'A fila de execução ambígua 99Food não ficou disponível.'
        )
      : reconciliations.length > 0
        ? gate(
            '99food_reconciliation',
            'Reconciliação 99Food',
            'attention',
            `${reconciliations.length} execução(ões) ainda exigem leitura/reconciliação antes de um novo ciclo limpo.`
          )
        : gate(
            '99food_reconciliation',
            'Reconciliação 99Food',
            'ready',
            'Nenhuma execução de status 99Food está em reconciliação nesta leitura.'
          )
  );

  const hasBlocked = gates.some(item => item.state === 'blocked');
  const hasUnknown = gates.some(item => item.state === 'unknown');
  const hasAttention = gates.some(item => item.state === 'attention');
  const normalizedSourceErrors = unique(sourceErrors);
  const overall: OmnichannelE2EOverallState = hasBlocked
    ? 'blocked'
    : hasUnknown || normalizedSourceErrors.length > 0
      ? 'partial'
      : hasAttention
        ? 'attention'
        : 'ready';

  return {
    storeId,
    checkedAt: new Date().toISOString(),
    overall,
    gates,
    sourceErrors: normalizedSourceErrors,
    mercadoLivre: {
      connected: mercadoLivreConnected,
      connectionStatus: mercadoLivreConnection?.status ?? 'absent',
      operationalItems: mercadoLivreOperationalItems,
    },
    ninetyNineFood: {
      connected: ninetyNineFoodConnected,
      adapterStatus: ninetyNineFoodStatus?.status ?? 'unavailable',
      registryStatus: ninetyNineFoodRegistryConnection?.status ?? 'absent',
      operationalItems: ninetyNineFoodOperationalItems,
      pendingStatusSyncs: pendingStatusSyncs.length,
      reconciliations: reconciliations.length,
    },
  };
};
