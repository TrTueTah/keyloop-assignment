import { TenantContext } from '../tenant-context';

export interface RequestContext {
  readonly requestId: string;
  tenant?: TenantContext;
}

/** Per-request context shared by presentation (writer) and logging adapters (reader). */
export interface RequestContextStore {
  run<T>(ctx: RequestContext, fn: () => T): T;
  current(): RequestContext | undefined;
  setTenant(tenant: TenantContext): void;
}
export const REQUEST_CONTEXT = Symbol('REQUEST_CONTEXT');
