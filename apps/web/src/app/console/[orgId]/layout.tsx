'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { OrgSwitcher } from '@/components/org-switcher';
import { RequireAuth } from '@/components/require-auth';
import { useAuth } from '@/lib/auth';

function Rail({ orgId }: { orgId: string }) {
  const path = usePathname();
  const { user, setActiveOrgId, activeOrgId } = useAuth();
  const membership = user?.memberships.find((m) => m.organizationId === orgId);
  const privileged = membership?.role === 'OWNER' || membership?.role === 'ADMIN';
  useEffect(() => {
    if (membership && activeOrgId !== orgId) setActiveOrgId(orgId);
  }, [membership, activeOrgId, orgId, setActiveOrgId]);

  const base = `/console/${orgId}`;
  const links = [
    {
      href: base,
      label: 'Tournaments',
      active: path === base || path.startsWith(`${base}/tournaments`),
    },
    { href: `${base}/disputes`, label: 'Disputes', active: path.startsWith(`${base}/disputes`) },
    { href: `${base}/staff`, label: 'Staff', active: path.startsWith(`${base}/staff`) },
    ...(privileged
      ? [{ href: `${base}/audit`, label: 'Audit log', active: path.startsWith(`${base}/audit`) }]
      : []),
  ];
  return (
    <aside className="flex flex-col gap-5 lg:w-60 lg:shrink-0">
      <OrgSwitcher currentOrgId={orgId} />
      <nav aria-label="Console" className="flex gap-1 overflow-x-auto lg:flex-col">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            aria-current={l.active ? 'page' : undefined}
            className={`rounded-md px-3 py-2 text-[15px] font-semibold whitespace-nowrap ${l.active ? 'bg-cobalt-wash text-cobalt-ink' : 'text-muted hover:text-ink'}`}
          >
            {l.label}
          </Link>
        ))}
      </nav>
      {privileged && !user?.mfaEnabled && (
        <div className="rounded-md border border-amber/60 bg-amber-wash p-3 text-sm">
          <p className="font-semibold">Turn on two-step sign-in</p>
          <p className="mt-1 text-muted">Owners and admins need it before changing tournaments.</p>
          <Link
            href="/account/security"
            className="mt-2 inline-block font-semibold text-cobalt hover:underline"
          >
            Set it up
          </Link>
        </div>
      )}
    </aside>
  );
}

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  const { orgId } = useParams<{ orgId: string }>();
  return (
    <RequireAuth>
      <div className="flex flex-col gap-8 lg:flex-row">
        <Rail orgId={orgId} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </RequireAuth>
  );
}
