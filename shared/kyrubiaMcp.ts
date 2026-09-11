export const KYRUB_MCP_PROTOCOL_VERSION = '2025-03-26' as const;

export type KyrubMcpReadToolName =
  | 'kyrub_get_store'
  | 'kyrub_list_products'
  | 'kyrub_get_inventory'
  | 'kyrub_list_pending_orders';

export type KyrubMcpToolName = KyrubMcpReadToolName | 'kyrubia_chat';

export type KyrubMcpToolDefinition = {
  name: KyrubMcpToolName;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: false;
    idempotentHint: boolean;
    openWorldHint: false;
  };
};

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const CONVERSATION_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

export const KYRUB_MCP_READ_TOOLS: KyrubMcpToolDefinition[] = [
  {
    name: 'kyrub_get_store',
    title: 'Consultar loja Kyrub',
    description: 'Retorna os dados básicos da loja do usuário autenticado no Kyrub.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: 'kyrub_list_products',
    title: 'Consultar catálogo Kyrub',
    description: 'Lista produtos do catálogo da loja do usuário. Pode filtrar por texto no nome.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', maxLength: 160 },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: 'kyrub_get_inventory',
    title: 'Consultar estoque de insumos',
    description: 'Consulta o estoque privado de insumos do usuário e suas quantidades atuais.',
    inputSchema: {
      type: 'object',
      properties: {
        names: {
          type: 'array',
          maxItems: 30,
          items: { type: 'string', minLength: 1, maxLength: 180 },
        },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: 'kyrub_list_pending_orders',
    title: 'Consultar pedidos pendentes',
    description: 'Lista pedidos pendentes ou em andamento da loja do usuário autenticado.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 30, default: 20 },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS,
  },
];

export const KYRUB_MCP_CHAT_TOOL: KyrubMcpToolDefinition = {
  name: 'kyrubia_chat',
  title: 'Conversar diretamente com a Kyrubia',
  description: 'Conversa com a Kyrubia usando um snapshot autoritativo somente leitura da loja do usuário. A ponte v0 nunca executa mutações: qualquer alteração precisa voltar ao fluxo de confirmação do Kyrub.',
  inputSchema: {
    type: 'object',
    properties: {
      message: { type: 'string', minLength: 1, maxLength: 4000 },
      conversationId: { type: 'string', maxLength: 180 },
      topic: { type: 'string', maxLength: 80 },
      history: {
        type: 'array',
        maxItems: 12,
        items: {
          type: 'object',
          properties: {
            role: { type: 'string', enum: ['user', 'assistant'] },
            content: { type: 'string', minLength: 1, maxLength: 4000 },
          },
          required: ['role', 'content'],
          additionalProperties: false,
        },
      },
    },
    required: ['message'],
    additionalProperties: false,
  },
  annotations: CONVERSATION_ANNOTATIONS,
};

export const KYRUB_MCP_TOOLS: KyrubMcpToolDefinition[] = [
  ...KYRUB_MCP_READ_TOOLS,
  KYRUB_MCP_CHAT_TOOL,
];

export const isKyrubMcpReadToolName = (value: unknown): value is KyrubMcpReadToolName =>
  typeof value === 'string' && KYRUB_MCP_READ_TOOLS.some(tool => tool.name === value);

export const isKyrubMcpToolName = (value: unknown): value is KyrubMcpToolName =>
  typeof value === 'string' && KYRUB_MCP_TOOLS.some(tool => tool.name === value);
