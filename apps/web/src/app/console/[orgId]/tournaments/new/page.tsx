'use client';

import type { TournamentDto } from '@arenacore/shared';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  emptyForm,
  FORM_SECTIONS,
  toPayload,
  TournamentFields,
  type FormSection,
} from '@/components/console/tournament-fields';
import { Button } from '@/components/ui/button';
import { ErrorNote } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/layout';
import { ApiError } from '@/lib/api';
import { useAction } from '@/lib/hooks';

const STEP_TITLES: Record<FormSection, string> = {
  basics: 'Game and region',
  format: 'Format',
  schedule: 'Schedule',
  rules: 'Rules and prizes',
};
const SECTION_OF: Record<string, FormSection> = {
  name: 'basics',
  gameId: 'basics',
  region: 'basics',
  platform: 'basics',
  description: 'basics',
  format: 'format',
  teamSize: 'format',
  maxSubstitutes: 'format',
  maxTeams: 'format',
  bestOf: 'format',
  finalsBestOf: 'format',
  registrationOpensAt: 'schedule',
  registrationClosesAt: 'schedule',
  checkInOpensAt: 'schedule',
  checkInClosesAt: 'schedule',
  startsAt: 'schedule',
  matchCheckInMinutes: 'schedule',
  rules: 'rules',
  prizeInfo: 'rules',
  minAge: 'rules',
};

/** Workflow A: a guided, ordered setup that ends in a draft (or a published event). */
export default function NewTournamentPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const router = useRouter();
  const [form, setForm] = useState(emptyForm);
  const [step, setStep] = useState(0);
  const section = FORM_SECTIONS[step]!;
  const [errors, setErrors] = useState<Record<string, string>>({});

  const create = useAction<void, TournamentDto>(
    () => ({ path: `/orgs/${orgId}/tournaments`, method: 'POST', body: toPayload(form) }),
    {
      invalidate: [[`/orgs/${orgId}/tournaments`]],
    },
  );
  const publish = useAction<string, TournamentDto>(
    (id) => ({ path: `/orgs/${orgId}/tournaments/${id}/publish`, method: 'POST' }),
    {
      success: 'Published',
    },
  );

  async function finish(andPublish: boolean) {
    setErrors({});
    let created: TournamentDto;
    try {
      created = await create.mutateAsync();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors);
        const first = Object.keys(err.fieldErrors)[0];
        if (first && SECTION_OF[first]) setStep(FORM_SECTIONS.indexOf(SECTION_OF[first]!));
      }
      return;
    }
    // A draft that isn't ready to publish still opens; the page lists what's missing.
    if (andPublish) await publish.mutateAsync(created.id).catch(() => undefined);
    router.replace(`/console/${orgId}/tournaments/${created.id}`);
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="New tournament" />
      <ol className="flex flex-wrap gap-2" aria-label="Setup steps">
        {FORM_SECTIONS.map((s, i) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => setStep(i)}
              aria-current={i === step ? 'step' : undefined}
              className={`flex items-center gap-2 rounded-full border px-3 py-1 text-[15px] font-semibold ${
                i === step
                  ? 'border-cobalt bg-cobalt-wash text-cobalt-ink'
                  : 'border-rule text-muted hover:text-ink'
              }`}
            >
              <span className="font-display text-lg">{i + 1}</span>
              {STEP_TITLES[s]}
            </button>
          </li>
        ))}
      </ol>
      <div className="rounded-lg border border-rule bg-surface p-5">
        <h2 className="mb-4 text-2xl font-semibold">{STEP_TITLES[section]}</h2>
        <TournamentFields form={form} onChange={setForm} section={section} errors={errors} />
      </div>
      <ErrorNote error={create.error && Object.keys(errors).length === 0 ? create.error : null} />
      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="secondary" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
          Back
        </Button>
        {step < FORM_SECTIONS.length - 1 ? (
          <Button onClick={() => setStep((s) => s + 1)}>Continue</Button>
        ) : (
          <div className="flex gap-2">
            <Button variant="secondary" busy={create.isPending} onClick={() => void finish(false)}>
              Save as draft
            </Button>
            <Button busy={create.isPending || publish.isPending} onClick={() => void finish(true)}>
              Create and publish
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
