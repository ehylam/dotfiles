import {createOpenRouter as createBase, openrouter as base} from '@openrouter/ai-sdk-provider';
import {guardProvider} from './openrouter-stream-guard.mjs';

export function createOpenRouter(options) {
  return guardProvider(createBase(options));
}

export const openrouter = guardProvider(base);
