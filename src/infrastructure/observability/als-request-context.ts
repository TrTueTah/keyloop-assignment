import { AsyncLocalStorage } from 'node:async_hooks';
import { RequestContext, RequestContextStore } from '../../application/ports/request-context';
import { TenantContext } from '../../application/tenant-context';

export class AlsRequestContextStore implements RequestContextStore {
  private readonly als = new AsyncLocalStorage<RequestContext>();

  run<T>(ctx: RequestContext, fn: () => T): T {
    return this.als.run(ctx, fn);
  }

  current(): RequestContext | undefined {
    return this.als.getStore();
  }

  setTenant(tenant: TenantContext): void {
    const ctx = this.als.getStore();
    if (ctx) ctx.tenant = tenant;
  }
}

/** Process-wide instance shared by the HTTP adapter (writer, via the port) and the logger (reader). */
export const requestContextStore = new AlsRequestContextStore();
