// src/app/mcp/route.ts — خادم MCP على المسار /mcp
// نعالج JSON-RPC يدوياً ونستخدم Server من SDK لإدارة الأدوات
// هذا أبسط وأكثر موثوقية في بيئة Next.js serverless
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  InitializeRequestSchema,
  type JSONRPCRequest,
  type JSONRPCResponse,
  type JSONRPCError,
} from '@modelcontextprotocol/sdk/types.js';
import { ensureSchema } from '@/lib/turso';
import { TOOL_DEFINITIONS, executeTool, SERVER_INSTRUCTIONS } from '@/lib/mcp-tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function checkAuth(req: Request): boolean {
  const token = process.env.MCP_ACCESS_TOKEN;
  if (!token) return true;
  const auth = req.headers.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return !!(m && m[1] === token);
}

// خادم لكل جلسة
const sessions = new Map<string, Server>();

function createServer(): Server {
  const server = new Server(
    { name: 'media-generator-mcp', version: '1.2.0' },
    {
      instructions: SERVER_INSTRUCTIONS,
      capabilities: { tools: {}, logging: {} },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as any,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const result = await executeTool(name, args || {});
    return { content: result.content, isError: result.isError } as any;
  });

  return server;
}

// معالجة رسالة JSON-RPC واحدة
async function handleMessage(message: JSONRPCRequest, server: Server): Promise<JSONRPCResponse | JSONRPCError | null> {
  const { id, method, params } = message;
  try {
    let result: any;
    if (method === 'initialize') {
      result = {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {}, logging: {} },
        serverInfo: { name: 'media-generator-mcp', version: '1.2.0' },
        instructions: SERVER_INSTRUCTIONS,
      };
    } else if (method === 'tools/list') {
      result = {
        tools: TOOL_DEFINITIONS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema as any,
        })),
      };
    } else if (method === 'tools/call') {
      const { name, arguments: args } = params as any;
      const r = await executeTool(name, args || {});
      result = { content: r.content, isError: r.isError };
    } else if (method === 'ping') {
      result = {};
    } else if (method === 'notifications/initialized') {
      // إشعار — لا رد
      return null;
    } else {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      } as JSONRPCError;
    }
    return { jsonrpc: '2.0', id, result } as JSONRPCResponse;
  } catch (e: any) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: e.message || 'Internal error' },
    } as JSONRPCError;
  }
}

export async function POST(req: Request) {
  if (!checkAuth(req)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try { await ensureSchema(); } catch (e) { console.error('ensureSchema:', e); }

  const body = await req.text();
  let message: JSONRPCRequest;
  try {
    message = JSON.parse(body);
  } catch {
    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32700, message: 'Parse error' },
      id: null,
    }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // إنشاء أو استرجاع خادم الجلسة
  let sessionId = req.headers.get('mcp-session-id') || '';
  let server: Server;
  if (sessionId && sessions.has(sessionId)) {
    server = sessions.get(sessionId)!;
  } else {
    sessionId = crypto.randomUUID();
    server = createServer();
    sessions.set(sessionId, server);
  }

  const response = await handleMessage(message, server);

  // إن كان notifications/initialized — لا محتوى
  if (response === null) {
    return new Response(null, {
      status: 202,
      headers: { 'mcp-session-id': sessionId },
    });
  }

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'mcp-session-id': sessionId,
    },
  });
}

export async function DELETE(req: Request) {
  if (!checkAuth(req)) return new Response('Unauthorized', { status: 401 });
  const sessionId = req.headers.get('mcp-session-id') || '';
  if (sessionId && sessions.has(sessionId)) {
    const server = sessions.get(sessionId)!;
    try { await server.close(); } catch {}
    sessions.delete(sessionId);
  }
  return new Response(null, { status: 204 });
}

export async function GET() {
  return new Response('Method Not Allowed', { status: 405 });
}
