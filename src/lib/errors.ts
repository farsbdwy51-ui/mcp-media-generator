// src/lib/errors.ts — تصنيف أخطاء المزودين
export type ErrorClass = 'disabled' | 'exhausted' | 'provider' | 'params' | 'temporary';

export class ProviderError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
    this.name = 'ProviderError';
  }
}

// دوال كشف الأنماط
const DISABLED_PATTERNS = [
  /invalid api key/i, /unauthorized/i, /forbidden/i, /authentication/i, /api[_ ]?key/i,
  /401/, /403/,
];

const EXHAUSTED_PATTERNS = [
  /insufficient/i, /quota/i, /balance/i, /credit/i, /out of credits/i, /exhausted/i,
  /充值/, /402/, /rate limit exceeded/i,
];

const PROVIDER_MODEL_PATTERNS = [
  /model not found/i, /unsupported model/i, /unknown model/i, /invalid model/i,
];

const TEMPORARY_PATTERNS = [
  /429/, /rate limit/i, /too many requests/i, /timeout/i, /timed out/i,
  /service unavailable/i, /bad gateway/i, /gateway timeout/i, /server error/i,
  /5\d\d/, /ECONNRESET/i, /ETIMEDOUT/i, /ENOTFOUND/i, /network/i,
];

// التصنيف الموحد — يفحص exhausted قبل 400 لأن بعض المزودين يرسلون نفاد الرصيد بحالة 400
export function classifyProviderError(status: number, message: string): ErrorClass {
  const msg = message || '';
  // فحص disabled أولًا (401/403)
  if (status === 401 || status === 403) return 'disabled';
  if (DISABLED_PATTERNS.some(p => p.test(msg))) return 'disabled';

  // exhausted — 402 أو أنماط الرصيد (افحصها قبل 400)
  if (status === 402) return 'exhausted';
  if (EXHAUSTED_PATTERNS.some(p => p.test(msg))) return 'exhausted';

  // temporary — 429 و 5xx
  if (status === 429) return 'temporary';
  if (status >= 500 && status < 600) return 'temporary';
  if (TEMPORARY_PATTERNS.some(p => p.test(msg))) return 'temporary';

  // provider — موديل غير مدعوم
  if (PROVIDER_MODEL_PATTERNS.some(p => p.test(msg))) return 'provider';

  // params — 400/422
  if (status === 400 || status === 422) return 'params';
  if (/invalid|bad request|missing|required/i.test(msg)) return 'params';

  return 'temporary'; // افتراضي للشبكة
}

// هل هذا الخطأ يستدعي التبديل لمفتاح آخر؟
export function shouldSwitchKey(cls: ErrorClass): boolean {
  // params لا يُبدَّل — خطأ في معطيات الطلب نفسه
  return cls !== 'params';
}
