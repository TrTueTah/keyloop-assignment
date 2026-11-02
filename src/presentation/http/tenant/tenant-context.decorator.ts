import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { isSiteContext, SiteContext, TenantContext } from '../../../application/tenant-context';
import { TenantRequest } from './tenant.guard';

function fromRequest(ctx: ExecutionContext): TenantContext {
  const tenant = ctx.switchToHttp().getRequest<TenantRequest>().tenantContext;
  if (!tenant) throw new Error('TenantGuard did not run for this route');
  return tenant;
}

/** Tenant-level context (routes without :dealershipId). */
export const Tenant = createParamDecorator((_: unknown, ctx: ExecutionContext): TenantContext =>
  fromRequest(ctx),
);

/** Site-scoped context (routes under /dealerships/:dealershipId). */
export const Site = createParamDecorator((_: unknown, ctx: ExecutionContext): SiteContext => {
  const tenant = fromRequest(ctx);
  if (!isSiteContext(tenant)) throw new Error('Route is not dealership-scoped');
  return tenant;
});
