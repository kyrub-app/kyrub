import {
  handleKyrubMcpRequest,
  type KyrubMcpHttpRequest,
  type KyrubMcpHttpResponse,
} from '../server/mcp/kyrubiaMcpServer.js';

export default async function handler(
  request: KyrubMcpHttpRequest,
  response: KyrubMcpHttpResponse
): Promise<void> {
  await handleKyrubMcpRequest(request, response);
}
