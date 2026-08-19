import assert from 'node:assert/strict';
import test from 'node:test';

import {
  KYRUB_MCP_PROTOCOL_VERSION,
  KYRUB_MCP_READ_TOOLS,
} from '../shared/kyrubiaMcp';
import { handleKyrubMcpRequest } from '../server/mcp/kyrubiaMcpServer';

test('Kyrubia MCP exposes only read-only tools in phase 3.9', () => {
  assert.equal(KYRUB_MCP_PROTOCOL_VERSION, '2025-03-26');
  assert.deepEqual(
    KYRUB_MCP_READ_TOOLS.map(tool => tool.name),
    [
      'kyrub_get_store',
      'kyrub_list_products',
      'kyrub_get_inventory',
      'kyrub_list_pending_orders',
    ]
  );
  for (const tool of KYRUB_MCP_READ_TOOLS) {
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.annotations.destructiveHint, false);
    assert.equal(tool.annotations.idempotentHint, true);
  }
});

test('Kyrubia MCP fails closed while feature flag is disabled', async () => {
  const original = process.env.KYRUB_MCP_ENABLED;
  process.env.KYRUB_MCP_ENABLED = 'false';

  let statusCode = 0;
  let body: any = null;
  const response = {
    setHeader() {},
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(value: unknown) {
      body = value;
    },
  };

  try {
    await handleKyrubMcpRequest({
      method: 'POST',
      headers: {},
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {},
      },
    }, response);
  } finally {
    if (original === undefined) delete process.env.KYRUB_MCP_ENABLED;
    else process.env.KYRUB_MCP_ENABLED = original;
  }

  assert.equal(statusCode, 503);
  assert.equal(body?.error?.data?.code, 'MCP_DISABLED');
});
