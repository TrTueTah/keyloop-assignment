/**
 * Who is asking, for which tenant (and site). Resolved by the TenantGuard from trusted identity
 * (X-Tenant-ID / X-User-ID stand in for JWT claims) plus the URL path (Constitution II).
 */
export interface TenantContext {
  readonly tenantId: string;
  readonly userId: string;
  readonly dealershipId?: string;
}

/** A TenantContext already scoped to one dealership (every site route). */
export interface SiteContext extends TenantContext {
  readonly dealershipId: string;
  /** The dealership's IANA zone, resolved with the dealership (used to render local offsets). */
  readonly timezone?: string;
}

export function isSiteContext(ctx: TenantContext): ctx is SiteContext {
  return typeof ctx.dealershipId === 'string';
}
