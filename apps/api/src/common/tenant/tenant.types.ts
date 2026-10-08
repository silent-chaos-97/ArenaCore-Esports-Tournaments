import type { OrgRole } from '@arenacore/shared';

export interface TenantContext {
  orgId: string;
  userId: string;
  role: OrgRole;
  membershipId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      tenant?: TenantContext;
    }
  }
}
