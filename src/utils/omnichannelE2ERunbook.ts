export type OmnichannelE2ERunbookActionKind =
  | 'read_only'
  | 'platform_write'
  | 'owner_authorization'
  | 'provider_write'
  | 'provider_external_action'
  | 'reconciliation';

export interface OmnichannelE2ERunbookStep {
  id: string;
  phase: 'preflight' | 'mercado_livre' | '99food_catalog' | '99food_order' | 'closeout';
  order: number;
  title: string;
  actionKinds: OmnichannelE2ERunbookActionKind[];
  instruction: string;
  expectedEvidence: string[];
  stopIf: string[];
  benchTarget?: 'mercado_livre' | '99food';
}

export interface OmnichannelE2ERunbookPhase {
  id: OmnichannelE2ERunbookStep['phase'];
  label: string;
  purpose: string;
  steps: OmnichannelE2ERunbookStep[];
}

const STEP = (
  step: OmnichannelE2ERunbookStep
): OmnichannelE2ERunbookStep => step;

export const OMNICHANNEL_E2E_RUNBOOK_STEPS: OmnichannelE2ERunbookStep[] = [
  STEP({
    id: 'preflight-readiness',
    phase: 'preflight',
    order: 10,
    title: 'Confirmar prontidão autoritativa antes de escrever',
    actionKinds: ['read_only'],
    instruction:
      'Atualize o painel de prontidão. Só comece um ciclo limpo quando conexões, autoridade física e filas anteriores estiverem compreendidas; estado parcial nunca vale como “sem pendências”.',
    expectedEvidence: [
      'Mercado Livre conectado no registro autoritativo da loja.',
      '99Food conectada tanto no adapter quanto no registro da loja.',
      'Autoridade canônica de estoque resolvida.',
      'Pendências pré-existentes, status manuais e reconciliações identificadas antes do teste.',
    ],
    stopIf: [
      'Qualquer gate estrutural estiver bloqueado.',
      'Alguma fonte estiver parcial sem explicação.',
      'Houver execução ambígua que ainda exige reconciliação.',
    ],
  }),
  STEP({
    id: 'ml-prepare-listing',
    phase: 'mercado_livre',
    order: 20,
    title: 'Preparar e validar anúncio sem publicar',
    actionKinds: ['read_only'],
    instruction:
      'Na bancada Mercado Livre, selecione um produto canônico elegível, crie a proposta, escolha categoria/tipo/condição e valide os requisitos oficiais sem autorizar publicação.',
    expectedEvidence: [
      'Produto canônico exato selecionado.',
      'Categoria e requisitos vindos da API do Mercado Livre.',
      'publicationReadiness = ready_for_owner_authorization.',
      'Nenhum anúncio criado ainda.',
    ],
    stopIf: [
      'O Mercado Livre exigir atributo ou correção não resolvida.',
      'A proposta deixar de representar o produto canônico selecionado.',
    ],
    benchTarget: 'mercado_livre',
  }),
  STEP({
    id: 'ml-publish-authorized',
    phase: 'mercado_livre',
    order: 30,
    title: 'Autorizar, publicar uma vez e reconciliar o anúncio',
    actionKinds: ['owner_authorization', 'provider_write', 'reconciliation'],
    instruction:
      'Crie a autorização one-time, execute “Publicar agora” uma única vez e depois confirme o anúncio por GET autoritativo antes de qualquer nova tentativa.',
    expectedEvidence: [
      'Autorização one-time criada pelo owner.',
      'executionId da publicação real.',
      'externalItemId/bindingId retornados.',
      'GET autoritativo confirma o anúncio antes de seguir para estoque.',
    ],
    stopIf: [
      'A execução ficar sem confirmação segura.',
      'A reconciliação não localizar exatamente o item criado.',
    ],
    benchTarget: 'mercado_livre',
  }),
  STEP({
    id: 'ml-stock-authorized',
    phase: 'mercado_livre',
    order: 40,
    title: 'Congelar ATP, autorizar estoque e reconciliar',
    actionKinds: ['platform_write', 'read_only', 'owner_authorization', 'provider_write', 'reconciliation'],
    instruction:
      'Salve a política explícita do canal, gere snapshot ATP, prepare a proposta de estoque, autorize o PUT one-time apenas se houver mudança e reconcilie a quantidade observada pelo Mercado Livre.',
    expectedEvidence: [
      'Política de disponibilidade explicitamente salva.',
      'Snapshot ATP congelado com quantidade publicável.',
      'Proposta separa no_changes, bloqueio e review_required.',
      'PUT, quando necessário, executado uma única vez.',
      'GET autoritativo confirma a quantidade observada final.',
    ],
    stopIf: [
      'O modo de estoque do provider bloquear a escrita.',
      'A execução ficar ambígua antes da reconciliação.',
    ],
    benchTarget: 'mercado_livre',
  }),
  STEP({
    id: '99food-bind-identity',
    phase: '99food_catalog',
    order: 50,
    title: 'Resolver binding e ItemOffer exato da 99Food',
    actionKinds: ['platform_write', 'read_only'],
    instruction:
      'Na bancada 99Food, vincule explicitamente o externalProductId ao produto canônico Kyrub, confirme capability Merchant V2 e resolva o Menu/ItemOffer exato antes de projetar disponibilidade.',
    expectedEvidence: [
      'Binding ativo externalProductId → canonicalProductId.',
      'Capability Merchant V2 confirmada pelo discovery.',
      'providerMenuId e providerItemOfferId resolvidos sem inferência por nome/SKU.',
    ],
    stopIf: [
      'A identidade do ItemOffer não for resolved.',
      'O binding canônico estiver ausente ou divergente.',
    ],
    benchTarget: '99food',
  }),
  STEP({
    id: '99food-availability-authorized',
    phase: '99food_catalog',
    order: 60,
    title: 'Projetar ATP, autorizar PATCH e reconciliar disponibilidade',
    actionKinds: ['platform_write', 'read_only', 'owner_authorization', 'provider_write', 'reconciliation'],
    instruction:
      'Salve a política 99Food, gere snapshot ATP, congele a proposta, crie autorização one-time, execute o PATCH real uma única vez e leia novamente o ItemOffer para reconciliar o target.',
    expectedEvidence: [
      'Revisão da política e snapshot ATP registrados.',
      'Target quantityAvailable congelado na proposta.',
      'Token one-time permanece apenas na memória da bancada.',
      'Execução termina em provider_write_accepted, provider_rejected ou reconciliation_required.',
      'Reconciliação confirma ou explicita divergência sem retry automático.',
    ],
    stopIf: [
      'A autorização one-time expirar ou desaparecer.',
      'A execução terminar ambígua sem reconciliação.',
    ],
    benchTarget: '99food',
  }),
  STEP({
    id: '99food-create-real-order',
    phase: '99food_order',
    order: 70,
    title: 'Criar um pedido real/controlado do lado da 99Food',
    actionKinds: ['provider_external_action'],
    instruction:
      'Crie ou dispare um pedido controlado pelo ambiente da 99Food usando o ItemOffer vinculado. Esta ação ocorre fora do Kyrub e deve produzir um evento Open Delivery real.',
    expectedEvidence: [
      'eventId/externalOrderId reais emitidos pela 99Food.',
      'Pedido aparece no Kyrub pelo ingress webhook/polling, não por criação manual local.',
      'Linhas externas são resolvidas pelos bindings ativos.',
    ],
    stopIf: [
      'O evento não possuir identidade Open Delivery válida.',
      'O pedido chegar com produto sem binding ou autoridade física não resolvida.',
    ],
    benchTarget: '99food',
  }),
  STEP({
    id: '99food-observe-reservation',
    phase: '99food_order',
    order: 80,
    title: 'Confirmar persistência canônica e reserva ATP',
    actionKinds: ['read_only'],
    instruction:
      'Antes de mudar status, confirme que o pedido inbound existe no pedido canônico/legado esperado e que a reserva de disponibilidade foi criada ou bloqueada com evidência explícita.',
    expectedEvidence: [
      'Pedido 99Food persistido com provider/externalOrderId corretos.',
      'Reserva ATP vinculada às linhas canônicas quando houver disponibilidade.',
      'Se bloqueado, a fila operacional informa binding, ATP ou autoridade ausente sem escolher fallback por inferência.',
    ],
    stopIf: [
      'O pedido não estiver persistido de forma canônica.',
      'A reserva estiver ausente sem blocker autoritativo explícito.',
    ],
  }),
  STEP({
    id: '99food-kyrub-only-status',
    phase: '99food_order',
    order: 90,
    title: 'Provar o ramo Kyrub-only sem provider write oculto',
    actionKinds: ['owner_authorization', 'platform_write', 'read_only'],
    instruction:
      'Em uma transição segura do pedido, escolha explicitamente “Atualizar só no Kyrub”. Confirme a mudança local e verifique que a fila de status manual recebeu exatamente aquele status/revisão.',
    expectedEvidence: [
      'Status local muda uma única vez.',
      'integration.outboundStatus = authorization_required.',
      'Nenhum sendAction/provider write ocorre nessa decisão.',
      'Fila manual expõe status exato e orderRevision atual.',
    ],
    stopIf: [
      'O provider receber a transição sem autorização explícita.',
      'A revisão exibida deixar de ser a revisão atual do pedido.',
    ],
  }),
  STEP({
    id: '99food-manual-status-sync',
    phase: '99food_order',
    order: 100,
    title: 'Autorizar envio manual do status exato e reconciliar ambiguidade',
    actionKinds: ['owner_authorization', 'provider_write', 'reconciliation'],
    instruction:
      'Na fila manual, revise e confirme o envio do status pendente. O servidor deve reivindicar executionId + orderRevision antes do provider write; qualquer resultado ambíguo vai para reconciliação sem retry automático.',
    expectedEvidence: [
      'Claim server-only vinculado ao executionId e orderRevision autorizados.',
      'localTransitionApplied = false no envio manual.',
      'Provider write ocorre no máximo uma vez para aquela autorização.',
      'sent encerra a pendência; outcome incerto entra em reconciliation_required.',
    ],
    stopIf: [
      'A orderRevision mudar antes do claim.',
      'Existir lock local de status ativo.',
      'Uma execução ambígua ainda não tiver sido reconciliada.',
    ],
  }),
  STEP({
    id: '99food-next-status-direct',
    phase: '99food_order',
    order: 110,
    title: 'Provar o ramo Kyrub + 99Food em uma transição seguinte',
    actionKinds: ['owner_authorization', 'platform_write', 'provider_write'],
    instruction:
      'Em uma próxima transição válida, escolha “Kyrub + 99Food”. A transição local deve acontecer primeiro e o provider write somente depois da autorização explícita para esse status exato.',
    expectedEvidence: [
      'Autorização não é reutilizada entre statuses.',
      'Status local não é revertido se a 99Food falhar.',
      'Falha externa vira atenção/reconciliação conforme o tipo de resultado, sem retry oculto.',
    ],
    stopIf: [
      'Uma autorização anterior for reaproveitada.',
      'O provider write ocorrer antes da transição local autoritativa.',
    ],
  }),
  STEP({
    id: 'closeout-clean',
    phase: 'closeout',
    order: 120,
    title: 'Encerrar somente com evidência limpa e reconciliada',
    actionKinds: ['read_only'],
    instruction:
      'Atualize novamente a prontidão e revise as filas. O ciclo só é considerado encerrado quando os resultados reais estiverem reconciliados ou explicitamente classificados para atenção manual.',
    expectedEvidence: [
      'Nenhuma execução ambígua ficou esquecida.',
      'Nenhum status manual pendente foi interpretado como enviado.',
      'Estoque/provider observados batem com os targets reconciliados ou possuem divergência explícita.',
      'Pedido canônico preserva o estado local final sem replay de transições.',
    ],
    stopIf: [
      'Houver reconciliation_required não tratado.',
      'Alguma fonte de prontidão voltar partial.',
    ],
  }),
];

const PHASE_META: Array<Pick<OmnichannelE2ERunbookPhase, 'id' | 'label' | 'purpose'>> = [
  {
    id: 'preflight',
    label: '0 · Pré-voo',
    purpose: 'Provar que o ambiente está compreendido antes de gerar qualquer nova evidência.',
  },
  {
    id: 'mercado_livre',
    label: '1 · Mercado Livre',
    purpose: 'Publicar e reconciliar catálogo/estoque com autorização explícita e leitura autoritativa.',
  },
  {
    id: '99food_catalog',
    label: '2 · 99Food catálogo/ATP',
    purpose: 'Resolver identidade e disponibilidade antes de usar um pedido real.',
  },
  {
    id: '99food_order',
    label: '3 · 99Food pedido/status',
    purpose: 'Provar ingress, reserva e os dois ramos de autoridade de status sem writes ocultos.',
  },
  {
    id: 'closeout',
    label: '4 · Encerramento',
    purpose: 'Fechar o ciclo apenas com estados reconciliados ou atenção explícita.',
  },
];

export const OMNICHANNEL_E2E_RUNBOOK_PHASES: OmnichannelE2ERunbookPhase[] =
  PHASE_META.map(meta => ({
    ...meta,
    steps: OMNICHANNEL_E2E_RUNBOOK_STEPS
      .filter(step => step.phase === meta.id)
      .sort((left, right) => left.order - right.order),
  }));
