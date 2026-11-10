// src/lib/merger.ts — عميل Video Merger API v2
// العنوان من MERGER_API_BASE (موقع دمج الفيديوهات المنشور)
// بلا مفاتيح أو توثيق. الناتج MP4 H.264 + AAC حتى 1080p بـ CRF 18.

const MERGER_BASE = process.env.MERGER_API_BASE || '';

if (!MERGER_BASE) {
  console.warn('MERGER_API_BASE غير مضبوط — الدمج لن يعمل');
}

interface MergeJobResponse {
  jobId: string;
  status: string;
  statusUrl: string;
  processUrl: string;
  expiresAt: string;
}

interface MergeProcessResponse {
  status: string;
  videoUrl?: string;
  downloadUrl?: string;
  size?: number;
  duration?: number;
  resolution?: string;
  expiresAt?: string;
  error?: string;
}

interface MergeStatusResponse {
  status: string;
  progress?: number;
  videoUrl?: string;
  downloadUrl?: string;
  size?: number;
  duration?: number;
  resolution?: string;
  error?: string;
}

// قفل في الذاكرة لمنع تزامن process مع get_task
const processInFlight = new Set<string>();

// إنشاء مهمة دمج
export async function createMergeJob(urls: string[]): Promise<MergeJobResponse> {
  if (!MERGER_BASE) throw new Error('MERGER_API_BASE غير مضبوط');
  const res = await fetch(`${MERGER_BASE}/api/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videos: urls }),
  });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    throw new Error(json.error || json.raw || `فشل إنشاء مهمة الدمج (HTTP ${res.status})`);
  }
  return json as MergeJobResponse;
}

// تنفيذ الدمج — يستغرق ~10–15 ثانية (blocking)
export async function processMergeJob(jobId: string): Promise<MergeProcessResponse> {
  if (!MERGER_BASE) throw new Error('MERGER_API_BASE غير مضبوط');
  // قفل لمنع التزامن
  if (processInFlight.has(jobId)) {
    return { status: 'processing' };
  }
  processInFlight.add(jobId);
  try {
    const res = await fetch(`${MERGER_BASE}/api/jobs/${jobId}/process`, {
      method: 'POST',
    });
    const text = await res.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    if (!res.ok) {
      // HTTP 500 + {"error":"..."} = فشل حتمي
      throw new Error(json.error || json.raw || `فشل تنفيذ الدمج (HTTP ${res.status})`);
    }
    return json as MergeProcessResponse;
  } finally {
    processInFlight.delete(jobId);
  }
}

// استعلام حالة مهمة الدمج
export async function getMergeStatus(jobId: string): Promise<MergeStatusResponse> {
  if (!MERGER_BASE) throw new Error('MERGER_API_BASE غير مضبوط');
  const res = await fetch(`${MERGER_BASE}/api/jobs/${jobId}`);
  if (res.status === 404) {
    throw new Error('مهمة الدمج غير موجودة في الخدمة (حُذفت أو انتهت صلاحيتها بعد 24 ساعة)');
  }
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    throw new Error(json.error || json.raw || `فشل استعلام الدمج (HTTP ${res.status})`);
  }
  // انتباه: قد يرد الجسم فيه error بدون حقل status → عاملها failed فورًا
  if (json.error && !json.status) {
    return { status: 'failed', error: json.error };
  }
  return json as MergeStatusResponse;
}

// فحص جهوزية خدمة الدمج
export async function mergerHealthy(): Promise<boolean> {
  if (!MERGER_BASE) return false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${MERGER_BASE}/api/config`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

export function getMergerBase(): string {
  return MERGER_BASE;
}

// تحليل الحالة
export function parseMergeStatus(s: string | undefined): 'processing' | 'completed' | 'failed' {
  if (!s) return 'processing';
  const lower = String(s).toLowerCase();
  if (['done', 'completed', 'complete', 'success', 'succeeded', 'finished'].includes(lower)) {
    return 'completed';
  }
  if (['error', 'failed', 'failure', 'cancelled'].includes(lower)) {
    return 'failed';
  }
  return 'processing';
}

// تحويل progress إلى نسبة 0..100
export function normalizeProgress(p: number | undefined): number {
  if (!p) return 0;
  if (p <= 1) return Math.round(p * 100); // قد يأتي كسر 0..1
  return Math.min(100, Math.round(p));
}
