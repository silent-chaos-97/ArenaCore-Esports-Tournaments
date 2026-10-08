'use client';

import type { MemberDto, OrgRole } from '@arenacore/shared';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ErrorNote, Loading } from '@/components/ui/feedback';
import { Field, Select, TextInput } from '@/components/ui/field';
import { DataTable, PageHeader, Section, Td } from '@/components/ui/layout';
import { useAuth } from '@/lib/auth';
import { formatDate, humanize } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';

const ROLES: OrgRole[] = ['OWNER', 'ADMIN', 'REFEREE', 'VIEWER'];
const ROLE_HINT: Record<OrgRole, string> = {
  OWNER: 'Full control, including other owners.',
  ADMIN: 'Runs tournaments and staff, except owners.',
  REFEREE: 'Enters results and rules on disputes.',
  VIEWER: 'Read-only access to the console.',
};

interface Invite {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
}

export default function StaffPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { user } = useAuth();
  const myRole = user?.memberships.find((m) => m.organizationId === orgId)?.role;
  const canManage = myRole === 'OWNER' || myRole === 'ADMIN';
  const membersPath = `/orgs/${orgId}/members`;
  const invitesPath = `/orgs/${orgId}/invites`;
  const members = useApi<MemberDto[]>(membersPath);
  const invites = useApi<Invite[]>(canManage ? invitesPath : null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgRole>('REFEREE');
  const [lastLink, setLastLink] = useState<string | null>(null);

  const invite = useAction<void, { token: string }>(
    () => ({ path: invitesPath, method: 'POST', body: { email, role } }),
    {
      success: 'Invitation created',
      invalidate: [[invitesPath]],
      onSuccess: (r) => {
        setLastLink(`${window.location.origin}/invites/accept?token=${r.token}`);
        setEmail('');
      },
    },
  );
  const revoke = useAction((id: string) => ({ path: `${invitesPath}/${id}`, method: 'DELETE' }), {
    success: 'Invitation revoked',
    invalidate: [[invitesPath]],
  });
  const changeRole = useAction(
    (input: { id: string; role: OrgRole }) => ({
      path: `${membersPath}/${input.id}`,
      method: 'PATCH',
      body: { role: input.role },
    }),
    {
      success: 'Role changed',
      invalidate: [[membersPath]],
    },
  );
  const remove = useAction((id: string) => ({ path: `${membersPath}/${id}`, method: 'DELETE' }), {
    success: 'Member removed',
    invalidate: [[membersPath]],
  });

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Staff" />
      {canManage && (
        <Section title="Invite staff">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1">
              <Field label="Email">
                {(p) => (
                  <TextInput
                    {...p}
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                )}
              </Field>
            </div>
            <div className="w-44">
              <Field label="Role">
                {(p) => (
                  <Select {...p} value={role} onChange={(e) => setRole(e.target.value as OrgRole)}>
                    {ROLES.filter((r) => r !== 'OWNER' || myRole === 'OWNER').map((r) => (
                      <option key={r} value={r}>
                        {humanize(r)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <Button busy={invite.isPending} disabled={!email} onClick={() => invite.mutate()}>
              Send invitation
            </Button>
          </div>
          <p className="text-sm text-muted">{ROLE_HINT[role]}</p>
          {lastLink && (
            <p className="rounded-md border border-rule bg-surface px-3 py-2 text-sm">
              Share this one-time link with them: <code className="break-all">{lastLink}</code>
            </p>
          )}
          <ErrorNote error={invite.error} />
          {(invites.data?.length ?? 0) > 0 && (
            <DataTable head={['Pending invitation', 'Role', 'Expires', '']}>
              {invites.data!.map((i) => (
                <tr key={i.id}>
                  <Td>{i.email}</Td>
                  <Td>{humanize(i.role)}</Td>
                  <Td className="text-muted">{formatDate(i.expiresAt)}</Td>
                  <Td className="text-right">
                    <Button variant="ghost" onClick={() => revoke.mutate(i.id)}>
                      Revoke
                    </Button>
                  </Td>
                </tr>
              ))}
            </DataTable>
          )}
        </Section>
      )}
      <Section title="Members">
        <ErrorNote error={changeRole.error ?? remove.error} />
        {members.isPending ? (
          <Loading />
        ) : (
          <DataTable head={['Name', 'Role', 'Two-step sign-in', 'Joined', '']}>
            {members.data?.map((m) => (
              <tr key={m.id}>
                <Td>
                  <span className="font-semibold">{m.displayName}</span>
                  <div className="text-sm text-muted">{m.email}</div>
                </Td>
                <Td>
                  {myRole === 'OWNER' && m.userId !== user?.id ? (
                    <Select
                      aria-label={`Role for ${m.displayName}`}
                      value={m.role}
                      onChange={(e) =>
                        changeRole.mutate({ id: m.id, role: e.target.value as OrgRole })
                      }
                      className="w-36"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {humanize(r)}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    humanize(m.role)
                  )}
                </Td>
                <Td className={m.mfaEnabled ? 'text-win' : 'text-muted'}>
                  {m.mfaEnabled ? 'On' : 'Off'}
                </Td>
                <Td className="text-muted">{formatDate(m.createdAt)}</Td>
                <Td className="text-right">
                  {canManage &&
                    m.userId !== user?.id &&
                    (m.role !== 'OWNER' || myRole === 'OWNER') && (
                      <Button variant="ghost" onClick={() => remove.mutate(m.id)}>
                        Remove
                      </Button>
                    )}
                </Td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>
    </div>
  );
}
