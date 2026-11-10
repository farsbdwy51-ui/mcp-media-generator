// src/app/api/keys/route.ts — إدارة المفاتيح
import { NextRequest, NextResponse } from 'next/server';
import { getAllKeys, insertKey, maskKey, ensureSchema } from '@/lib/turso';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  await ensureSchema();
  const keys = await getAllKeys();
  // إخفاء المفاتيح دائمًا
  const masked = keys.map((k) => ({
    ...k,
    api_key: maskKey(k.api_key),
  }));
  return NextResponse.json({ keys: masked });
}

export async function POST(req: NextRequest) {
  await ensureSchema();
  try {
    const body = await req.json();
    const { provider, api_key, label } = body;
    if (!provider || !['kie', 'cometapi'].includes(provider)) {
      return NextResponse.json({ error: 'المزود يجب أن يكون kie أو cometapi' }, { status: 400 });
    }
    if (!api_key || typeof api_key !== 'string') {
      return NextResponse.json({ error: 'المفتاح مطلوب' }, { status: 400 });
    }
    const id = await insertKey({ provider, api_key, label });
    return NextResponse.json({ ok: true, id, masked: maskKey(api_key) }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
