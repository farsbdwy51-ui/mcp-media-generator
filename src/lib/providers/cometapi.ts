// src/lib/providers/cometapi.ts — مزود CometAPI (المزود الثاني)
// صور متزامنة عبر نقطة images المتوافقة مع OpenAI
// فيديو عبر نقطة المهام غير المتزامنة بنفس نمط create/check
import { ProviderError } from '../errors';
import type { ApiKeyRef, ProviderAdapter, ProviderCheckResult, ProviderInput } from './types';

const COMET_BASE = process.env.COMETAPI_BASE || 'https://api.cometapi.com/v1';

// صور متزامنة عبر نقطة images/generations (متوافقة مع OpenAI)
async function createImageSync(key: ApiKeyRef, input: ProviderInput): Promise<{ urls: string[] }> {
  const body: Record<string, unknown> = {
    model: input.model,
    prompt: input.prompt,
    n: 1,
    response_format: 'url',
  };
  if (input.aspect_ratio && input.aspect_ratio !== 'auto') {
    body.size = aspectRatioToSize(input.aspect_ratio);
  }

  const res = await fetch(`${COMET_BASE}/images/generations`, {
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

  if (!res.ok) {
    const msg = json.error?.message || json.error || json.message || json.raw || `HTTP ${res.status}`;
    throw new ProviderError(res.status, msg, json);
  }

  const data = json.data || [];
  const urls: string[] = [];
  for (const item of data) {
    if (item.url) urls.push(item.url);
    else if (item.b64_json) urls.push(`data:image/png;base64,${item.b64_json}`);
  }
  if (urls.length === 0) {
    throw new ProviderError(res.status, 'استجابة CometAPI غير متوقعة: لا توجد روابط', json);
  }
  return { urls };
}

// فيديو عبر نقطة المهام غير المتزامنة
async function createTask(key: ApiKeyRef, model: string, input: ProviderInput): Promise<{ providerTaskId: string }> {
  const body: Record<string, unknown> = {
    model,
    prompt: input.prompt,
    duration: input.duration || 8,
    aspect_ratio: input.aspect_ratio || 'auto',
    resolution: input.resolution || '480p',
    enable_audio: input.enable_audio !== false,
  };
  if (input.image_url) body.image_url = input.image_url;

  const res = await fetch(`${COMET_BASE}/video/generations`, {
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

  if (!res.ok) {
    const msg = json.error?.message || json.error || json.message || json.raw || `HTTP ${res.status}`;
    throw new ProviderError(res.status, msg, json);
  }

  const taskId = json.id || json.task_id || json.data?.task_id || json.data?.id;
  if (!taskId) {
    throw new ProviderError(res.status, 'استجابة CometAPI غير متوقعة: لا يوجد taskId', json);
  }
  return { providerTaskId: String(taskId) };
}

async function checkTask(key: ApiKeyRef, providerTaskId: string): Promise<ProviderCheckResult> {
  const res = await fetch(`${COMET_BASE}/video/generations/${encodeURIComponent(providerTaskId)}`, {
    headers: { Authorization: `Bearer ${key.api_key}` },
  });

  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }

  if (!res.ok) {
    const msg = json.error?.message || json.error || json.message || json.raw || `HTTP ${res.status}`;
    throw new ProviderError(res.status, msg, json);
  }

  const status = String(json.status || json.state || '').toLowerCase();
  if (status === 'succeeded' || status === 'completed' || status === 'success' || status === 'done') {
    const urls: string[] = [];
    if (json.url) urls.push(json.url);
    if (json.video_url) urls.push(json.video_url);
    if (Array.isArray(json.urls)) urls.push(...json.urls);
    if (json.data?.url) urls.push(json.data.url);
    if (Array.isArray(json.data?.results)) {
      for (const r of json.data.results) {
        if (r.url) urls.push(r.url);
      }
    }
    if (urls.length === 0) {
      return { status: 'failed', error: 'لا توجد روابط نتائج في استجابة CometAPI' };
    }
    return { status: 'completed', urls, progress: 100 };
  }
  if (status === 'failed' || status === 'error') {
    return { status: 'failed', error: json.error || json.message || 'فشل المهمة لدى CometAPI' };
  }
  // جارية
  return { status: 'processing', progress: json.progress ? Math.min(99, Number(json.progress)) : 30 };
}

// تحويل aspect_ratio إلى size متوافق مع OpenAI
function aspectRatioToSize(ar: string): string {
  const map: Record<string, string> = {
    '1:1': '1024x1024',
    '3:2': '1536x1024',
    '2:3': '1024x1536',
    '16:9': '1792x1024',
    '9:16': '1024x1792',
    '4:3': '1280x960',
    '3:4': '960x1280',
  };
  return map[ar] || '1024x1024';
}

export const cometapiProvider: ProviderAdapter = { createTask, createImageSync, checkTask };
