/**
 * Operational help taxonomy: code is immutable audit data, label is UI copy.
 * A support report is NOT a cancellation, return authorization or payout action.
 * Before pickup = accepted; after pickup = delivering.
 */
export type CourierSupportStage = 'accepted' | 'delivering';
export type CourierSupportPriority = 'safety' | 'urgent' | 'normal';
export type CourierSupportGroup = 'safety' | 'pickup' | 'route' | 'delivery' | 'app' | 'other';

export interface CourierSupportReason {
  code: string;
  label: string;
  group: CourierSupportGroup;
  priority: CourierSupportPriority;
  stages: readonly CourierSupportStage[];
  guidance: string;
}

export const KYRUB_COURIER_SUPPORT_REASONS: readonly CourierSupportReason[] = [
  {
    code:'accident_or_injury',label:'Acidente ou ferimento',group:'safety',priority:'safety',
    stages:['accepted','delivering'],
    guidance:'Se houver feridos, vá para um local seguro quando possível e ligue 192 (SAMU) ou 193 (Bombeiros). O Kyrub não aciona socorro automaticamente.',
  },
  {
    code:'threat_robbery_or_harassment',label:'Ameaça, assalto ou agressão',group:'safety',priority:'safety',
    stages:['accepted','delivering'],
    guidance:'Não se exponha. Se houver perigo imediato, ligue 190. Abrir um chamado não substitui a polícia.',
  },
  {
    code:'unsafe_pickup_or_dropoff',label:'Local perigoso ou inseguro',group:'safety',priority:'safety',
    stages:['accepted','delivering'],
    guidance:'Priorize um lugar seguro. Relate o ocorrido para a logística sem tentar resolver a situação sozinho.',
  },
  {
    code:'merchant_closed',label:'Loja fechada ou inacessível',group:'pickup',priority:'urgent',
    stages:['accepted'],
    guidance:'Confirme o endereço e relate a impossibilidade de coleta. O chamado não cancela o pedido.',
  },
  {
    code:'package_not_ready',label:'Pedido ainda não está pronto',group:'pickup',priority:'normal',
    stages:['accepted'],
    guidance:'Informe que chegou à loja e há espera. O tempo de espera e eventual remuneração seguem as regras próprias.',
  },
  {
    code:'package_missing_or_wrong',label:'Pedido errado, incompleto ou danificado',group:'pickup',priority:'urgent',
    stages:['accepted'],
    guidance:'Não confirme a coleta de um pacote diferente ou com irregularidade. Solicite conferência da loja.',
  },
  {
    code:'pickup_code_problem',label:'Problema com código de coleta',group:'pickup',priority:'normal',
    stages:['accepted'],
    guidance:'Peça que a loja confira o código; nunca compartilhe senhas ou códigos por chat aberto.',
  },
  {
    code:'vehicle_breakdown',label:'Pneu furado ou veículo com defeito',group:'route',priority:'urgent',
    stages:['accepted','delivering'],
    guidance:'Estacione em local seguro. Após a coleta, preserve a encomenda e aguarde instrução de transferência supervisionada.',
  },
  {
    code:'road_blocked_or_wrong_route',label:'Rota bloqueada ou acesso impossível',group:'route',priority:'normal',
    stages:['accepted','delivering'],
    guidance:'Descreva a via bloqueada. Não altere o destino contratual nem faça entrega em outro endereço sem autorização.',
  },
  {
    code:'destination_incorrect',label:'Endereço do destinatário incorreto',group:'delivery',priority:'urgent',
    stages:['delivering'],
    guidance:'Confirme os dados do pedido. Não entregue em outro endereço nem faça mudança de rota por conta própria.',
  },
  {
    code:'recipient_not_found',label:'Destinatário não atende ou não aparece',group:'delivery',priority:'urgent',
    stages:['delivering'],
    guidance:'Tente contatar o destinatário pelos canais autorizados e registre as tentativas. Aguarde orientação antes de devolver.',
  },
  {
    code:'recipient_refused',label:'Destinatário recusou a encomenda',group:'delivery',priority:'urgent',
    stages:['delivering'],
    guidance:'Mantenha a posse do pacote e aguarde logística para devolução ou outro procedimento seguro.',
  },
  {
    code:'delivery_confirmation_problem',label:'Problema no código ou confirmação de entrega',group:'delivery',priority:'normal',
    stages:['delivering'],
    guidance:'Não marque o pedido como entregue sem confirmação verificável do comprador.',
  },
  {
    code:'package_damaged_or_lost_in_transit',label:'Encomenda danificada ou extraviada',group:'delivery',priority:'urgent',
    stages:['delivering'],
    guidance:'Relate o ocorrido com detalhes; não finalize a entrega nem prometa reembolso sem decisão registrada.',
  },
  {
    code:'app_location_or_connection',label:'Erro no aplicativo, internet ou GPS',group:'app',priority:'normal',
    stages:['accepted','delivering'],
    guidance:'Verifique permissões de GPS e conexão em local seguro. Não insira localização manual ou simulada.',
  },
  {
    code:'unexpected_payment_or_fee',label:'Dúvida sobre valor, distância ou espera',group:'other',priority:'normal',
    stages:['accepted','delivering'],
    guidance:'Informe a divergência para conferência. Chamados não alteram remuneração nem geram créditos automaticamente.',
  },
  {
    code:'other_issue',label:'Outro problema nesta entrega',group:'other',priority:'normal',
    stages:['accepted','delivering'],
    guidance:'Descreva o problema e a ajuda necessária. Se envolver risco imediato, use a Central de Segurança.',
  },
];

export const getCourierSupportReason = (code: unknown, stage: CourierSupportStage):
  CourierSupportReason | null => typeof code === 'string'
  ? KYRUB_COURIER_SUPPORT_REASONS.find(reason => reason.code === code
    && reason.stages.includes(stage)) ?? null
  : null;

export const supportPriorityRank = (priority: CourierSupportPriority): number =>
  priority === 'safety' ? 0 : priority === 'urgent' ? 1 : 2;
