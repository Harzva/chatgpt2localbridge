import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';

export interface SafeRequestContext {
  source: 'http' | 'stdio';
  transportSessionId?: string;
  requestId?: string;
  requestIdHash?: string;
  userAgent?: string;
  connectorProfile?: string;
  conversationId?: string;
  conversationIdHash?: string;
}

const contextStorage = new AsyncLocalStorage<SafeRequestContext>();

export function runWithRequestContext<T>(context: SafeRequestContext, fn: () => Promise<T>): Promise<T> {
  return contextStorage.run(context, fn);
}

export function getRequestContext(): SafeRequestContext {
  return contextStorage.getStore() ?? { source: 'stdio' };
}

export function hashContextValue(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
