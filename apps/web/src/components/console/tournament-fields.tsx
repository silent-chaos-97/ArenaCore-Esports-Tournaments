'use client';

import type { GameDto, TournamentDto } from '@arenacore/shared';
import { Checkbox, Field, Select, TextArea, TextInput } from '@/components/ui/field';
import { fromLocalInput, toLocalInput } from '@/lib/format';
import { useApi } from '@/lib/hooks';

/** Form state mirrors the API's tournament settings; dates are kept as datetime-local strings. */
export interface TournamentForm {
  name: string;
  description: string;
  gameId: string;
  region: string;
  platform: string;
  format: 'SINGLE_ELIMINATION' | 'DOUBLE_ELIMINATION';
  teamSize: number;
  maxSubstitutes: number;
  maxTeams: number;
  bestOf: number;
  finalsBestOf: string;
  grandFinalReset: boolean;
  requireApproval: boolean;
  minAge: string;
  registrationOpensAt: string;
  registrationClosesAt: string;
  useCheckIn: boolean;
  checkInOpensAt: string;
  checkInClosesAt: string;
  startsAt: string;
  matchCheckInMinutes: number;
  rules: string;
  prizeInfo: string;
}

export const FORM_SECTIONS = ['basics', 'format', 'schedule', 'rules'] as const;
export type FormSection = (typeof FORM_SECTIONS)[number];

export function emptyForm(): TournamentForm {
  const hour = 3600_000;
  const at = (offset: number) =>
    toLocalInput(new Date(Math.ceil(Date.now() / hour) * hour + offset).toISOString());
  return {
    name: '',
    description: '',
    gameId: '',
    region: 'EU',
    platform: 'PC',
    format: 'SINGLE_ELIMINATION',
    teamSize: 5,
    maxSubstitutes: 1,
    maxTeams: 16,
    bestOf: 1,
    finalsBestOf: '',
    grandFinalReset: true,
    requireApproval: true,
    minAge: '',
    registrationOpensAt: at(0),
    registrationClosesAt: at(6 * 24 * hour),
    useCheckIn: true,
    checkInOpensAt: at(7 * 24 * hour - hour),
    checkInClosesAt: at(7 * 24 * hour - 15 * 60_000),
    startsAt: at(7 * 24 * hour),
    matchCheckInMinutes: 15,
    rules: '',
    prizeInfo: '',
  };
}

export function formFromTournament(t: TournamentDto): TournamentForm {
  return {
    name: t.name,
    description: t.description ?? '',
    gameId: t.gameId,
    region: t.region,
    platform: t.platform,
    format: t.format as TournamentForm['format'],
    teamSize: t.teamSize,
    maxSubstitutes: t.maxSubstitutes,
    maxTeams: t.maxTeams,
    bestOf: t.bestOf,
    finalsBestOf: t.finalsBestOf ? String(t.finalsBestOf) : '',
    grandFinalReset: t.grandFinalReset,
    requireApproval: t.requireApproval,
    minAge: t.minAge ? String(t.minAge) : '',
    registrationOpensAt: toLocalInput(t.registrationOpensAt),
    registrationClosesAt: toLocalInput(t.registrationClosesAt),
    useCheckIn: t.checkInOpensAt !== null,
    checkInOpensAt: toLocalInput(t.checkInOpensAt),
    checkInClosesAt: toLocalInput(t.checkInClosesAt),
    startsAt: toLocalInput(t.startsAt),
    matchCheckInMinutes: t.matchCheckInMinutes,
    rules: t.rules,
    prizeInfo: t.prizeInfo ?? '',
  };
}

/** Converts form state into the API payload. */
export function toPayload(f: TournamentForm) {
  return {
    name: f.name,
    description: f.description || null,
    gameId: f.gameId,
    region: f.region,
    platform: f.platform,
    format: f.format,
    teamSize: Number(f.teamSize),
    maxSubstitutes: Number(f.maxSubstitutes),
    maxTeams: Number(f.maxTeams),
    bestOf: Number(f.bestOf),
    finalsBestOf: f.finalsBestOf ? Number(f.finalsBestOf) : null,
    grandFinalReset: f.grandFinalReset,
    requireApproval: f.requireApproval,
    minAge: f.minAge ? Number(f.minAge) : null,
    registrationOpensAt: fromLocalInput(f.registrationOpensAt),
    registrationClosesAt: fromLocalInput(f.registrationClosesAt),
    checkInOpensAt: f.useCheckIn ? fromLocalInput(f.checkInOpensAt) : null,
    checkInClosesAt: f.useCheckIn ? fromLocalInput(f.checkInClosesAt) : null,
    startsAt: fromLocalInput(f.startsAt),
    matchCheckInMinutes: Number(f.matchCheckInMinutes),
    rules: f.rules,
    prizeInfo: f.prizeInfo || null,
  };
}

const BEST_OF = [1, 3, 5, 7];

export function TournamentFields({
  form,
  onChange,
  section,
  errors = {},
  locked = [],
}: {
  form: TournamentForm;
  onChange: (form: TournamentForm) => void;
  section: FormSection;
  errors?: Record<string, string>;
  locked?: string[];
}) {
  const games = useApi<GameDto[]>('/games', { publicRoute: true });
  const set = <K extends keyof TournamentForm>(key: K, value: TournamentForm[K]) =>
    onChange({ ...form, [key]: value });
  const isLocked = (field: string) => locked.includes(field);
  const lockHint = (field: string) =>
    isLocked(field) ? 'Locked because teams have registered or the event is live.' : undefined;

  if (section === 'basics') {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Tournament name" error={errors.name} hint={lockHint('name')}>
            {(p) => (
              <TextInput
                {...p}
                disabled={isLocked('name')}
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
              />
            )}
          </Field>
        </div>
        <Field label="Game" error={errors.gameId} hint={lockHint('gameId')}>
          {(p) => (
            <Select
              {...p}
              disabled={isLocked('gameId')}
              value={form.gameId}
              onChange={(e) => set('gameId', e.target.value)}
            >
              <option value="">Choose a game</option>
              {games.data?.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="Region"
          error={errors.region}
          hint={lockHint('region') ?? 'For example EU, NA or APAC.'}
        >
          {(p) => (
            <TextInput
              {...p}
              disabled={isLocked('region')}
              value={form.region}
              onChange={(e) => set('region', e.target.value)}
            />
          )}
        </Field>
        <Field label="Platform" error={errors.platform} hint={lockHint('platform')}>
          {(p) => (
            <TextInput
              {...p}
              disabled={isLocked('platform')}
              value={form.platform}
              onChange={(e) => set('platform', e.target.value)}
            />
          )}
        </Field>
        <div className="sm:col-span-2">
          <Field
            label="Description"
            error={errors.description}
            hint="Shown on the public tournament page."
          >
            {(p) => (
              <TextArea
                {...p}
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
              />
            )}
          </Field>
        </div>
      </div>
    );
  }

  if (section === 'format') {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Format" error={errors.format} hint={lockHint('format')}>
          {(p) => (
            <Select
              {...p}
              disabled={isLocked('format')}
              value={form.format}
              onChange={(e) => set('format', e.target.value as TournamentForm['format'])}
            >
              <option value="SINGLE_ELIMINATION">Single elimination</option>
              <option value="DOUBLE_ELIMINATION">Double elimination</option>
            </Select>
          )}
        </Field>
        <Field label="Maximum teams" error={errors.maxTeams}>
          {(p) => (
            <TextInput
              {...p}
              type="number"
              min={2}
              max={256}
              value={form.maxTeams}
              onChange={(e) => set('maxTeams', Number(e.target.value))}
            />
          )}
        </Field>
        <Field label="Players per team" error={errors.teamSize} hint={lockHint('teamSize')}>
          {(p) => (
            <TextInput
              {...p}
              type="number"
              min={1}
              max={10}
              disabled={isLocked('teamSize')}
              value={form.teamSize}
              onChange={(e) => set('teamSize', Number(e.target.value))}
            />
          )}
        </Field>
        <Field
          label="Substitutes allowed"
          error={errors.maxSubstitutes}
          hint={lockHint('maxSubstitutes')}
        >
          {(p) => (
            <TextInput
              {...p}
              type="number"
              min={0}
              max={5}
              disabled={isLocked('maxSubstitutes')}
              value={form.maxSubstitutes}
              onChange={(e) => set('maxSubstitutes', Number(e.target.value))}
            />
          )}
        </Field>
        <Field label="Matches are best of" error={errors.bestOf}>
          {(p) => (
            <Select
              {...p}
              disabled={isLocked('bestOf')}
              value={form.bestOf}
              onChange={(e) => set('bestOf', Number(e.target.value))}
            >
              {BEST_OF.map((n) => (
                <option key={n} value={n}>
                  Best of {n}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="Finals are best of"
          error={errors.finalsBestOf}
          hint="Leave as “Same as other matches” to keep one format."
        >
          {(p) => (
            <Select
              {...p}
              disabled={isLocked('finalsBestOf')}
              value={form.finalsBestOf}
              onChange={(e) => set('finalsBestOf', e.target.value)}
            >
              <option value="">Same as other matches</option>
              {BEST_OF.map((n) => (
                <option key={n} value={n}>
                  Best of {n}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {form.format === 'DOUBLE_ELIMINATION' && (
          <div className="sm:col-span-2">
            <Checkbox
              label="Play a second grand final if the lower-bracket team wins the first"
              checked={form.grandFinalReset}
              disabled={isLocked('grandFinalReset')}
              onChange={(e) => set('grandFinalReset', e.target.checked)}
            />
          </div>
        )}
      </div>
    );
  }

  if (section === 'schedule') {
    const dt = (key: keyof TournamentForm, label: string, hint?: string) => (
      <Field label={label} error={errors[key]} hint={hint}>
        {(p) => (
          <TextInput
            {...p}
            type="datetime-local"
            disabled={isLocked(key)}
            value={form[key] as string}
            onChange={(e) => set(key, e.target.value as never)}
          />
        )}
      </Field>
    );
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {dt('registrationOpensAt', 'Registration opens')}
        {dt('registrationClosesAt', 'Registration closes')}
        <div className="sm:col-span-2">
          <Checkbox
            label="Teams must check in before the tournament starts"
            checked={form.useCheckIn}
            disabled={isLocked('checkInOpensAt')}
            onChange={(e) => set('useCheckIn', e.target.checked)}
          />
        </div>
        {form.useCheckIn && (
          <>
            {dt('checkInOpensAt', 'Check-in opens')}
            {dt(
              'checkInClosesAt',
              'Check-in closes',
              'Teams that haven’t checked in by then don’t enter the bracket.',
            )}
          </>
        )}
        {dt('startsAt', 'Tournament starts')}
        <Field
          label="Match check-in window (minutes)"
          error={errors.matchCheckInMinutes}
          hint="Use 0 to let teams play as soon as both are known."
        >
          {(p) => (
            <TextInput
              {...p}
              type="number"
              min={0}
              max={120}
              value={form.matchCheckInMinutes}
              onChange={(e) => set('matchCheckInMinutes', Number(e.target.value))}
            />
          )}
        </Field>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field
          label="Rules"
          error={errors.rules}
          hint="Players accept this exact version when they register. Changing it later asks them to accept again."
        >
          {(p) => (
            <TextArea
              {...p}
              className="min-h-48"
              value={form.rules}
              onChange={(e) => set('rules', e.target.value)}
            />
          )}
        </Field>
      </div>
      <Field label="Prizes" error={errors.prizeInfo}>
        {(p) => (
          <TextInput
            {...p}
            placeholder="€500 and trophies"
            value={form.prizeInfo}
            onChange={(e) => set('prizeInfo', e.target.value)}
          />
        )}
      </Field>
      <Field
        label="Minimum player age"
        error={errors.minAge}
        hint={lockHint('minAge') ?? 'Leave empty for no age limit.'}
      >
        {(p) => (
          <TextInput
            {...p}
            type="number"
            min={13}
            max={99}
            disabled={isLocked('minAge')}
            value={form.minAge}
            onChange={(e) => set('minAge', e.target.value)}
          />
        )}
      </Field>
      <div className="sm:col-span-2">
        <Checkbox
          label="Review every registration before teams are accepted"
          checked={form.requireApproval}
          disabled={isLocked('requireApproval')}
          onChange={(e) => set('requireApproval', e.target.checked)}
        />
      </div>
    </div>
  );
}
