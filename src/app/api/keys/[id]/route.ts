// src/app/api/keys/[id]/route.ts — تعطيل/تنشيط/حذف مفتاح
import { NextRequest, NextResponse } from 'next/server';
import { updateKey, deleteKey, getKey, maskKey, ensureSchema } from '@/lib/turso';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await ensureSchema();
  try {
    const { id } = await params;
    const body = await req.json();
    const patch: any = {};
    if (body.status && ['active', 'exhausted', 'disabled'].includes(body.status)) {
      patch.status = body.status;
    }
    if (typeof body.label === 'string') patch.label = body.label;
    await updateKey(id, patch);
    const updated = await getKey(id);
    if (!updated) return NextResponse.json({ error: 'المفتاح غير موجود' }, { status: 404 });
    return NextResponse.json({ ok: true, key: { ...updated, api_key: maskKey(updated.api_key) } });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await ensureSchema();
  try {
    const { id } = await params;
    await deleteKey(id);
    return NextResponse.json({ ok: true, deleted: id });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
