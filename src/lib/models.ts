// src/lib/models.ts — سجل الموديلات والمزودون
export type ProviderId = 'kie' | 'cometapi';
export type TaskProvider = ProviderId | 'merger';
export type MediaType = 'image' | 'video' | 'merge';

export interface ModelDef {
  canonical: string;
  aliases: string[];
  type: MediaType;
  providers: ProviderId[];
  providerModel: Record<ProviderId, string>;
}

// الموديلان المدمجان — قابلان للتجاوز بمتغيرات البيئة
const IMAGE_MODEL_KIE = process.env.KIE_IMAGE_MODEL || 'gpt-image-2-6/flare-text-to-image';
const IMAGE_MODEL_COMET = process.env.COMETAPI_IMAGE_MODEL || 'gpt-image-2.6-flare-text-to-image';
const VIDEO_MODEL_KIE = process.env.KIE_VIDEO_MODEL || 'grok-imagine-video-1-5-preview';
const VIDEO_MODEL_COMET = process.env.COMETAPI_VIDEO_MODEL || 'grok-imagine-video-1-5-preview';

export const MODELS: ModelDef[] = [
  {
    canonical: 'gpt-image-2-6/flare-text-to-image',
    aliases: ['gpt-image-2-6/flare-text-to-image', 'gpt-image-2.6/flare-text-to-image', 'gpt-image-2.6-flare-text-to-image'],
    type: 'image',
    providers: ['kie', 'cometapi'],
    providerModel: { kie: IMAGE_MODEL_KIE, cometapi: IMAGE_MODEL_COMET },
  },
  {
    canonical: 'grok-imagine-video-1-5-preview',
    aliases: ['grok-imagine-video-1-5-preview', 'grok-imagine-video-1.5-preview'],
    type: 'video',
    providers: ['kie', 'cometapi'],
    providerModel: { kie: VIDEO_MODEL_KIE, cometapi: VIDEO_MODEL_COMET },
  },
];

// توحيد اسم الموديل — يقبل الصيغ البديلة
export function resolveModel(name: string): ModelDef | null {
  const normalized = name.trim().toLowerCase();
  for (const m of MODELS) {
    if (m.aliases.some(a => a.toLowerCase() === normalized)) return m;
    if (m.canonical.toLowerCase() === normalized) return m;
  }
  return null;
}

export function getMergeModel(): string {
  return 'video-merger';
}
