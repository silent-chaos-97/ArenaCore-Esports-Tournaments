'use client';

import type { MemberDto } from '@arenacore/shared';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorNote } from '@/components/ui/feedback';
import { Field, Select } from '@/components/ui/field';
import { DataTable, Section, Td } from '@/components/ui/layout';
import { humanize } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';

interface StaffRow {
  userId: string;
  displayName: string;
  email: string;
  role: string;
}

/** Tournament-scoped referees and admins, chosen from the organization's members. */
export function TournamentStaffPanel({
  orgId,
  tournamentId,
}: {
  orgId: string;
  tournamentId: string;
}) {
  const path = `/orgs/${orgId}/tournaments/${tournamentId}/staff`;
  const staff = useApi<StaffRow[]>(path);
  const members = useApi<MemberDto[]>(`/orgs/${orgId}/members`);
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<'REFEREE' | 'ADMIN'>('REFEREE');
  const assign = useAction(() => ({ path, method: 'POST', body: { userId, role } }), {
    success: 'Staff assigned',
    invalidate: [[path]],
  });
  const remove = useAction((id: string) => ({ path: `${path}/${id}`, method: 'DELETE' }), {
    success: 'Staff removed',
    invalidate: [[path]],
  });

  return (
    <Section title="Tournament staff">
      <p className="max-w-prose text-[15px] text-muted">
        Assigned referees can rule on disputes and enter results for this tournament only.
        Organization owners and admins already have access.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56">
          <Field label="Member">
            {(p) => (
              <Select {...p} value={userId} onChange={(e) => setUserId(e.target.value)}>
                <option value="">Choose a member</option>
                {members.data?.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.displayName} ({humanize(m.role)})
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="w-40">
          <Field label="Role">
            {(p) => (
              <Select
                {...p}
                value={role}
                onChange={(e) => setRole(e.target.value as 'REFEREE' | 'ADMIN')}
              >
                <option value="REFEREE">Referee</option>
                <option value="ADMIN">Tournament admin</option>
              </Select>
            )}
          </Field>
        </div>
        <Button busy={assign.isPending} disabled={!userId} onClick={() => assign.mutate()}>
          Assign
        </Button>
      </div>
      <ErrorNote error={assign.error ?? remove.error} />
      {staff.data?.length === 0 ? (
        <EmptyState title="No tournament staff yet" />
      ) : (
        <DataTable head={['Name', 'Role', '']}>
          {staff.data?.map((s) => (
            <tr key={s.userId}>
              <Td>
                <span className="font-semibold">{s.displayName}</span>
                <div className="text-sm text-muted">{s.email}</div>
              </Td>
              <Td>{humanize(s.role)}</Td>
              <Td className="text-right">
                <Button variant="ghost" onClick={() => remove.mutate(s.userId)}>
                  Remove
                </Button>
              </Td>
            </tr>
          ))}
        </DataTable>
      )}
    </Section>
  );
}
