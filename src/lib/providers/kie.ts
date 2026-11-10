// src/lib/providers/kie.ts — مزود kie.ai (المزود الأساسي) — Jobs API الموحد
import { ProviderError } from '../errors';
import type { ApiKeyRef, ProviderAdapter, ProviderCheckResult, ProviderInput } from './types';

const KIE_BASE = 'https://api.kie.ai/api/v1/jobs';

// إنشاء مهمة عند kie.ai
async function createTask(key: ApiKeyRef, model: string, input: ProviderInput): Promise<{ providerTaskId: string }> {
  const body: Record<string, unknown> = { model, input: { ...input } };
  // تنظيف الحقول الفارغة
  Object.keys(body.input).forEach((k) => {
    if (body.input[k] === undefined || body.input[k] === null || body.input[k] === '') {
      delete body.input[k];
    }
  });

  const res = await fetch(`${KIE_BASE}/createTask`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key.api_key}`,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }

  if (!res.ok || json.code !== 200) {
    const msg = json.message || json.error || json.raw || `HTTP ${res.status}`;
    throw new ProviderError(res.status, msg, json);
  }

  const taskId = json.data?.taskId;
  if (!taskId) {
    throw new ProviderError(res.status, 'استجابة kie غير متوقعة: لا يوجد taskId', json);
  }
  return { providerTaskId: String(taskId) };
}

// استعلام حالة مهمة kie.ai
async function checkTask(key: ApiKeyRef, providerTaskId: string): Promise<ProviderCheckResult> {
  const res = await fetch(`${KIE_BASE}/recordInfo?taskId=${encodeURIComponent(providerTaskId)}`, {
    headers: { Authorization: `Bearer ${key.api_key}` },
  });

  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }

  if (!res.ok || json.code !== 200) {
    const msg = json.message || json.error || json.raw || `HTTP ${res.status}`;
    throw new ProviderError(res.status, msg, json);
  }

  const data = json.data || {};
  const state = String(data.state || '').toLowerCase();
  // حالات kie: waiting, queuing, generating, success, fail
  if (state === 'success' || state === 'completed' || state === 'done') {
    // resultJson نص يحتاج JSON.parse ثانيًا
    let urls: string[] = [];
    try {
      const parsed = typeof data.resultJson === 'string' ? JSON.parse(data.resultJson) : data.resultJson;
      urls = parsed?.resultUrls || parsed?.urls || (Array.isArray(parsed) ? parsed : []);
    } catch {
      urls = [];
    }
    if (urls.length === 0) {
      return { status: 'failed', error: 'لا توجد روابط نتائج في استجابة kie' };
    }
    return { status: 'completed', urls, progress: 100 };
  }
  if (state === 'fail' || state === 'failed' || state === 'error') {
    return { status: 'failed', error: data.failMsg || 'فشل المهمة لدى kie' };
  }
  // جارية
  let progress = 10;
  if (state === 'generating') progress = 60;
  else if (state === 'queuing') progress = 30;
  return { status: 'processing', progress };
}

export const kieProvider: ProviderAdapter = { createTask, checkTask };
