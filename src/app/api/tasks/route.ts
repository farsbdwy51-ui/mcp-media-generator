// src/app/api/tasks/route.ts — قائمة المهام للواجهة
import { NextRequest, NextResponse } from 'next/server';
import { listRecentTasks, taskStats, ensureSchema } from '@/lib/turso';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  await ensureSchema();
  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get('limit') || '20', 10);
  const type = searchParams.get('type') || undefined;
  const status = searchParams.get('status') || undefined;
  const [tasks, stats] = await Promise.all([
    listRecentTasks(limit, { type, status }),
    taskStats(),
  ]);
  return NextResponse.json({ tasks, stats });
}
