// src/lib/providers/index.ts — سجل المزودات
import { kieProvider } from './kie';
import { cometapiProvider } from './cometapi';
import type { ProviderAdapter, ApiKeyRef } from './types';

export const PROVIDERS: Record<'kie' | 'cometapi', ProviderAdapter> = {
  kie: kieProvider,
  cometapi: cometapiProvider,
};

export type { ProviderAdapter, ApiKeyRef, ProviderInput, ProviderCheckResult } from './types';
