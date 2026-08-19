import {
  KYRUB_MCP_PROTOCOL_VERSION,
  KYRUB_MCP_READ_TOOLS,
  isKyrubMcpToolName,
} from '../../shared/kyrubiaMcp.js';
import {
  KyrubMcpAuthError,
  verifyKyrubMcpAuthorization,
} from './kyrubiaMcpAuth.js';
import { callKyrubMcpReadTool } from './kyrubiaMcpReadService.js';

type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
};

export type KyrubMcpHttpRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};

export type KyrubMcpHttpResponse = {
  setHeader(name: string, value: string): void;
  status(code: number): KyrubMcpHttpResponse;
  json(body: unknown): void;
  end?: () => void;
};

const headerValue = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? value[0] ?? '' : value ?? '';

const responseEnvelope = (id: JsonRpcId, result: unknown) => ({
  jsonrpc: '2.0',
  id,
  result,
});

const errorEnvelope = (
  id: JsonRpcId,
  code: number,
  message: string,
  data?: Record<string, unknown>
) => ({
  jsonrpc: '2.0',
  id,
  error: { code, message, ...(data ? { data } : {}) },
});

const requestRecord = (body: unknown): JsonRpcRequest | null =>
  body && typeof body === 'object' && !Array.isArray(body)
    ? body as JsonRpcRequest
    : null;

const paramsRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const normalizeId = (value: unknown): JsonRpcId => {
  if (typeof value === 'string' || typeof value === 'number') return value;
  return null;
};

const toolResult = (value: Record<string, unknown>) => ({
  content: [{ type: 'text', text: JSON.stringify(value) }],
  structuredContent: value,
  isError: false,
});

export const handleKyrubMcpRequest = async (
  request: KyrubMcpHttpRequest,
  response: KyrubMcpHttpResponse
): Promise<void> => {
  response.setHeader('cache-control', 'no-store, max-age=0');
  response.setHeader('content-type', 'application/json; charset=utf-8');

  const method = (request.method ?? 'GET').toUpperCase();
  if (method === 'GET') {
    response.status(405).json({
      error: 'Use Streamable HTTP via POST para acessar o MCP da Kyrubia.',
      code: 'MCP_POST_REQUIRED',
    });
    return;
  }
  if (method !== 'POST') {
    response.status(405).json({ error: 'Método não permitido.', code: 'METHOD_NOT_ALLOWED' });
    return;
  }

  const rpc = requestRecord(request.body);
  const id = normalizeId(rpc?.id);
  if (!rpc || rpc.jsonrpc !== '2.0' || typeof rpc.method !== 'string') {
    response.status(400).json(errorEnvelope(id, -32600, 'Invalid Request'));
    return;
  }

  try {
    const authorization = headerValue(
      request.headers.authorization ?? request.headers.Authorization
    );
    const principal = await verifyKyrubMcpAuthorization(authorization);

    if (rpc.method === 'notifications/initialized') {
      response.status(202);
      response.end?.();
      return;
    }

    if (rpc.method === 'initialize') {
      response.status(200).json(responseEnvelope(id, {
        protocolVersion: KYRUB_MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'kyrubia', version: '0.1.0' },
        instructions: 'Use as ferramentas do Kyrub somente para os dados do usuário autenticado. Esta versão é somente leitura.',
      }));
      return;
    }

    if (rpc.method === 'ping') {
      response.status(200).json(responseEnvelope(id, {}));
      return;
    }

    if (rpc.method === 'tools/list') {
      response.status(200).json(responseEnvelope(id, { tools: KYRUB_MCP_READ_TOOLS }));
      return;
    }

    if (rpc.method === 'tools/call') {
      const params = paramsRecord(rpc.params);
      const name = params.name;
      if (!isKyrubMcpToolName(name)) {
        response.status(200).json(errorEnvelope(id, -32602, 'Ferramenta desconhecida.'));
        return;
      }
      const args = paramsRecord(params.arguments);
      const value = await callKyrubMcpReadTool(principal, name, args);
      response.status(200).json(responseEnvelope(id, toolResult(value)));
      return;
    }

    response.status(200).json(errorEnvelope(id, -32601, 'Method not found'));
  } catch (error) {
    if (error instanceof KyrubMcpAuthError) {
      response.status(error.status).json(errorEnvelope(id, -32001, error.message, {
        code: error.code,
      }));
      return;
    }
    console.error('[Kyrubia MCP] request failed.', error);
    response.status(500).json(errorEnvelope(id, -32603, 'Erro interno do servidor MCP.'));
  }
};
