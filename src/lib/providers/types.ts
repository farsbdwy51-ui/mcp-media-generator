// src/lib/providers/types.ts — واجهة المزودات الموحدة
export interface ProviderInput {
  prompt: string;
  model: string;
  aspect_ratio?: string;
  resolution?: string;
  background?: string;
  output_format?: string;
  image_url?: string;
  enable_audio?: boolean;
  duration?: number;
}

export interface ProviderCheckResult {
  status: 'processing' | 'completed' | 'failed';
  urls?: string[];
  error?: string;
  progress?: number;
}

export interface ApiKeyRef {
  id: string;
  provider: 'kie' | 'cometapi';
  api_key: string;
  label: string;
}

export interface ProviderAdapter {
  createTask(key: ApiKeyRef, model: string, input: ProviderInput): Promise<{ providerTaskId: string }>;
  createImageSync?(key: ApiKeyRef, input: ProviderInput): Promise<{ urls: string[] }>;
  checkTask(key: ApiKeyRef, providerTaskId: string): Promise<ProviderCheckResult>;
}
