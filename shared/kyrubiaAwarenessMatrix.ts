export const KYRUBIA_AWARENESS_PRECEDENCE = [
  'authoritative_kyrub_data',
  'official_kyrub_action',
  'conversation_context',
  'manual_rag',
  'external_ai',
] as const;

export type KyrubiaAwarenessDomain =
  | 'store'
  | 'catalog'
  | 'inventory'
  | 'orders'
  | 'logistics'
  | 'payments'
  | 'account';

export type KyrubiaAwarenessCapability = {
  domain: KyrubiaAwarenessDomain;
  authoritativeSource: string;
  readExamples: readonly string[];
  writePath: 'official_action' | 'read_only' | 'foundation_pending';
  status: 'active' | 'partial' | 'planned';
};

export const KYRUBIA_AWARENESS_CAPABILITIES: readonly KyrubiaAwarenessCapability[] = [
  {
    domain: 'store',
    authoritativeSource: 'private store + tenant operational settings',
    readExamples: [
      'qual é o endereço da minha loja?',
      'qual é o nome da minha loja?',
      'minha loja está aberta?',
      'quais são os dados da minha loja?',
    ],
    writePath: 'official_action',
    status: 'active',
  },
  {
    domain: 'catalog',
    authoritativeSource: 'canonical store catalog',
    readExamples: ['quantos produtos tenho?', 'quais produtos estão sem imagem?'],
    writePath: 'official_action',
    status: 'active',
  },
  {
    domain: 'inventory',
    authoritativeSource: 'private inventory + movement ledger',
    readExamples: ['quanto tenho deste insumo?', 'quais insumos estão com estoque baixo?'],
    writePath: 'official_action',
    status: 'active',
  },
  {
    domain: 'orders',
    authoritativeSource: 'canonical customer orders',
    readExamples: ['quantos pedidos estão em andamento?', 'o que tem no pedido 123?'],
    writePath: 'official_action',
    status: 'active',
  },
  {
    domain: 'logistics',
    authoritativeSource: 'delivery opportunities + private delivery tracking',
    readExamples: ['quem está fazendo esta entrega?', 'onde está o entregador?'],
    writePath: 'official_action',
    status: 'partial',
  },
  {
    domain: 'payments',
    authoritativeSource: 'canonical payment ledger / PSP events',
    readExamples: ['este pedido está pago?', 'o estorno foi concluído?'],
    writePath: 'foundation_pending',
    status: 'planned',
  },
  {
    domain: 'account',
    authoritativeSource: 'authenticated user + plan entitlements',
    readExamples: ['qual é meu plano?', 'qual é o meu limite de produtos?'],
    writePath: 'official_action',
    status: 'partial',
  },
] as const;

export const getKyrubiaAwarenessCapability = (
  domain: KyrubiaAwarenessDomain
): KyrubiaAwarenessCapability | undefined =>
  KYRUBIA_AWARENESS_CAPABILITIES.find(capability => capability.domain === domain);
