// src/app/api/health/route.ts — فحص صحة الخدمة
import { NextResponse } from 'next/server';
import { dbHealthy } from '@/lib/turso';
import { MODELS } from '@/lib/models';
import { mergerHealthy, getMergerBase } from '@/lib/merger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const healthy = await dbHealthy();
  const mergerOk = await mergerHealthy();
  const authRequired = !!process.env.MCP_ACCESS_TOKEN;

  return NextResponse.json({
    ok: healthy,
    database: healthy ? 'turso-connected' : 'turso-disconnected',
    mcpEndpoint: '/mcp',
    models: MODELS.map((m) => ({
      canonical: m.canonical,
      type: m.type,
      providers: m.providers,
    })),
    merger: {
      base: getMergerBase(),
      healthy: mergerOk,
    },
    authRequired,
  });
}
