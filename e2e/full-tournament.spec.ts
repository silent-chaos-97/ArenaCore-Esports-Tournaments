import { expect, test, type Page } from '@playwright/test';
import { call, captainWithTeam, PASSWORD, type Captain } from './api';

/**
 * The MVP acceptance scenario end to end: an organizer creates and publishes a tournament,
 * teams register (one through the UI), the organizer approves and starts it, captains report
 * scores, conflicting reports become a dispute a referee resolves, and the public page crowns
 * the champion.
 */
const run = Date.now().toString(36).slice(-5);

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/me');
}

test('a full single-elimination tournament from creation to champion', async ({
  page,
  browser,
}) => {
  const tournamentName = `E2E Cup ${run}`;

  // ── Organizer signs up and creates an organization (AUTH-01, AUTH-03) ──
  const organizerEmail = `organizer.${run}@e2e.arenacore.local`;
  await page.goto('/register');
  await page.getByLabel('Display name').fill('E2E Organizer');
  await page.getByLabel('Email').fill(organizerEmail);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL('**/me');
  await page.getByRole('link', { name: 'Organize', exact: true }).click();
  await page.getByLabel('Organization name').fill(`E2E League ${run}`);
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page.getByRole('heading', { name: 'Tournaments', exact: true })).toBeVisible();

  // ── Workflow A: create and publish through the wizard (criterion 1) ──
  await page.getByRole('link', { name: 'New tournament' }).first().click();
  await page.getByLabel('Tournament name').fill(tournamentName);
  await page.getByLabel('Game').selectOption({ label: 'VALORANT' });
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Maximum teams').fill('4');
  await page.getByLabel('Players per team').fill('1');
  await page.getByLabel('Substitutes allowed').fill('0');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Teams must check in before the tournament starts').uncheck();
  await page.getByLabel('Match check-in window (minutes)').fill('0');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page
    .getByLabel('Rules')
    .fill('Best of one. Captains report the score right after the match.');
  await page.getByRole('button', { name: 'Create and publish' }).click();
  await expect(page.getByRole('heading', { name: tournamentName, exact: true })).toBeVisible();
  await expect(page.getByText('Published', { exact: true }).first()).toBeVisible();
  const consoleUrl = page.url().split('?')[0]!;
  const tournamentId = consoleUrl.split('/').pop()!;
  const slug = (await page.getByRole('link', { name: 'Public page' }).getAttribute('href'))!
    .split('/')
    .pop()!;

  // ── Teams register; captain one uses the UI (workflow B, criterion 2) ──
  const captains: Captain[] = [];
  for (const tag of ['Alpha', 'Bravo', 'Charlie', 'Delta'])
    captains.push(await captainWithTeam(tag, run));
  const playerContext = await browser.newContext();
  const player = await playerContext.newPage();
  await signIn(player, captains[0]!.email);
  await player.goto(`/t/${slug}/register`);
  await player.getByLabel('Register this team').selectOption({ label: captains[0]!.teamName });
  await player.getByLabel(/I’ve read the rules/).check();
  await player.getByRole('button', { name: 'Submit registration' }).click();
  await expect(
    player.getByRole('heading', { name: 'Registration sent', exact: true }),
  ).toBeVisible();
  for (const c of captains.slice(1)) {
    await call(`/tournaments/${tournamentId}/registrations`, {
      token: c.token,
      body: {
        teamId: c.teamId,
        members: [{ playerId: c.playerId, role: 'CAPTAIN' }],
        acceptRules: true,
        rulesVersion: 1,
      },
    });
  }

  // ── Organizer approves everyone and starts (criteria 3, 5, 6) ──
  await page.goto(`${consoleUrl}?tab=registrations`);
  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: 'Approve', exact: true }).first().click();
    await expect(page.getByText('Registration updated').last()).toBeVisible();
  }
  await page.getByRole('tab', { name: /Accepted/ }).click();
  await expect(page.getByRole('row')).toHaveCount(5);
  await page.getByRole('button', { name: 'Start tournament' }).click();
  await page.getByRole('button', { name: 'Start with 4 teams' }).click();
  await expect(page.getByRole('region', { name: 'Tournament bracket' })).toBeVisible();

  const teamOf = new Map(captains.map((c) => [c.teamName, c]));
  type M = {
    id: string;
    key: string;
    tournamentId: string;
    a: { teamName: string };
    b: { teamName: string };
  };

  // ── Captain one's semifinal: reported in the match room, opponent confirms (criteria 7, 8) ──
  const semi1 = (await call<M[]>('/matches/mine', { token: captains[0]!.token })).find(
    (m) => m.tournamentId === tournamentId,
  )!;
  await player.goto(`/me/matches/${semi1.id}`);
  const mineIsA = semi1.a.teamName === captains[0]!.teamName;
  await player.getByLabel(`${semi1.a.teamName} wins`).fill(mineIsA ? '1' : '0');
  await player.getByLabel(`${semi1.b.teamName} wins`).fill(mineIsA ? '0' : '1');
  await player.getByRole('button', { name: 'Report score' }).click();
  await expect(player.getByText(/Waiting for your opponent/)).toBeVisible();
  const opponent = teamOf.get(mineIsA ? semi1.b.teamName : semi1.a.teamName)!;
  await call(`/matches/${semi1.id}/results`, {
    token: opponent.token,
    body: { scoreA: mineIsA ? 1 : 0, scoreB: mineIsA ? 0 : 1 },
  });
  await player.reload();
  await expect(player.getByText('Completed', { exact: true }).first()).toBeVisible();

  // ── The other semifinal: conflicting reports open a dispute (criterion 9) ──
  const semi2 = await findMatch(tournamentId, semi1.key === 'W1-1' ? 'W1-2' : 'W1-1', captains);
  await call(`/matches/${semi2.id}/results`, {
    token: teamOf.get(semi2.a.teamName)!.token,
    body: { scoreA: 1, scoreB: 0 },
  });
  await call(`/matches/${semi2.id}/results`, {
    token: teamOf.get(semi2.b.teamName)!.token,
    body: { scoreA: 0, scoreB: 1 },
  });

  // ── Referee (the organizer) resolves it in the dispute workspace (criteria 10, 11) ──
  await page.getByRole('link', { name: 'Disputes', exact: true }).click();
  await page.getByRole('link', { name: 'Incorrect result' }).first().click();
  await expect(page.getByText(`${semi2.a.teamName} reported`)).toBeVisible();
  await page.getByRole('button', { name: 'Assign to me' }).click();
  await expect(page.getByText('Dispute assigned').last()).toBeVisible();
  await page.getByLabel(semi2.a.teamName, { exact: true }).fill('1');
  await page.getByLabel(semi2.b.teamName, { exact: true }).fill('0');
  await page.getByLabel('Ruling').fill('Game client screenshots show the first team won the map.');
  await page.getByRole('button', { name: 'Record ruling' }).click();
  await expect(page.getByRole('heading', { name: 'Ruling', exact: true })).toBeVisible();

  // ── Final, then the public page shows the champion (criteria 12, 13) ──
  const final = await findMatch(tournamentId, 'W2-1', captains);
  for (const side of [final.a, final.b]) {
    await call(`/matches/${final.id}/results`, {
      token: teamOf.get(side.teamName)!.token,
      body: { scoreA: 1, scoreB: 0 },
    });
  }
  const audit = await page.goto(`${consoleUrl.replace(/\/tournaments\/.*/, '')}/audit`);
  expect(audit?.ok()).toBe(true);
  await expect(page.getByText('dispute: resolved')).toBeVisible();

  const spectator = await (await browser.newContext()).newPage();
  await spectator.goto(`/t/${slug}`);
  await expect(spectator.getByText('Champion')).toBeVisible({ timeout: 45_000 });
  await expect(spectator.getByRole('link', { name: final.a.teamName }).first()).toBeVisible();

  // Players received notifications along the way.
  const inbox = await call<{ items: { type: string }[] }>('/notifications', {
    token: captains[0]!.token,
  });
  expect(inbox.items.map((n) => n.type)).toEqual(
    expect.arrayContaining(['REGISTRATION_APPROVED', 'RESULT_CONFIRMED']),
  );
  await playerContext.close();
});

/** Finds a match by bracket key through any participating captain's view. */
async function findMatch(tournamentId: string, key: string, captains: Captain[]) {
  for (const c of captains) {
    const mine = await call<
      {
        id: string;
        key: string;
        tournamentId: string;
        a: { teamName: string };
        b: { teamName: string };
      }[]
    >('/matches/mine', { token: c.token });
    const hit = mine.find((m) => m.key === key && m.tournamentId === tournamentId);
    if (hit) return hit;
  }
  throw new Error(`No captain sees match ${key}`);
}
