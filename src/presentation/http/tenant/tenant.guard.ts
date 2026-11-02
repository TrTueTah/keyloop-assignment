import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { REQUEST_CONTEXT, RequestContextStore } from '../../../application/ports/request-context';
import { TenantContext } from '../../../application/tenant-context';
import { ResolveTenantContext } from '../../../application/use-cases/resolve-tenant-context';
import { DomainError } from '../../../domain/errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USER = /^[\x21-\x7E]{1,128}$/;

export type TenantRequest = Request & { tenantContext?: TenantContext };

/**
 * Resolves TenantContext BEFORE any business logic (Constitution II). The tenant comes from trusted
 * identity headers (stand-ins for JWT claims), never the body; the dealership from the URL path.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly resolve: ResolveTenantContext,
    @Inject(REQUEST_CONTEXT) private readonly store: RequestContextStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<TenantRequest>();
    const tenantId = req.header('x-tenant-id');
    const userId = req.header('x-user-id');
    const errors = [
      ...(tenantId && UUID.test(tenantId)
        ? []
        : [{ field: 'X-Tenant-ID', message: 'must be a UUID header' }]),
      ...(userId && USER.test(userId)
        ? []
        : [{ field: 'X-User-ID', message: 'must be 1-128 printable characters' }]),
    ];
    if (errors.length > 0)
      throw new DomainError('VALIDATION_FAILED', 'Missing or invalid identity headers', { errors });

    const dealershipId =
      typeof req.params?.dealershipId === 'string' ? req.params.dealershipId : undefined;
    const ctx = await this.resolve.execute(tenantId!, userId!, dealershipId);
    req.tenantContext = ctx;
    this.store.setTenant(ctx);
    return true;
  }
}
