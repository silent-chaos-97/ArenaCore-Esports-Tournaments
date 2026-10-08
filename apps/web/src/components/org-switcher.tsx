'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { humanize } from '@/lib/format';

/** Switches the organization the console is acting for. */
export function OrgSwitcher({ currentOrgId }: { currentOrgId: string }) {
  const { user, setActiveOrgId } = useAuth();
  const router = useRouter();
  if (!user || user.memberships.length === 0) return null;
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-semibold text-muted">Organization</span>
      <select
        value={currentOrgId}
        onChange={(e) => {
          if (e.target.value === '__new') return router.push('/console?new=1');
          setActiveOrgId(e.target.value);
          router.push(`/console/${e.target.value}`);
        }}
        className="h-10 rounded-md border border-rule bg-surface px-3 text-[15px] font-semibold"
      >
        {user.memberships.map((m) => (
          <option key={m.organizationId} value={m.organizationId}>
            {m.organizationName} ({humanize(m.role)})
          </option>
        ))}
        <option value="__new">New organization…</option>
      </select>
    </label>
  );
}
