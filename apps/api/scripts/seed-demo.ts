/**
 * Fills a running local API with a believable demo through the public HTTP API:
 * an organization, teams with linked accounts, a live double-elimination event with results and
 * a dispute, plus an open-registration tournament. Run: pnpm --filter @arenacore/api seed:demo
 *
 * Requires MFA_ENFORCED=false (the local default) so the demo owner can act without a TOTP app.
 */
const API = process.env.API_URL ?? 'http://localhost:4000/api/v1';
const PASSWORD = 'arenacore-demo';
const HOUR = 3600_000;

interface Session {
  token: string;
  email: string;
  userId: string;
  playerId: string;
}

async function call<T>(
  path: string,
  init: { method?: string; body?: unknown; token?: string } = {},
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: {
      'content-type': 'application/json',
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 429) {
    // Credential endpoints are rate limited; wait out the window like a polite client.
    const wait = Number(res.headers.get('retry-after') ?? '10');
    console.log(`Rate limited on ${path}, waiting ${wait}s…`);
    await new Promise((r) => setTimeout(r, wait * 1000));
    return call<T>(path, init);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}: ${text}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

async function account(email: string, displayName: string): Promise<Session> {
  let auth: { accessToken: string };
  try {
    auth = await call('/auth/register', { body: { email, password: PASSWORD, displayName } });
  } catch (error) {
    if (!String(error).includes('EMAIL_TAKEN')) throw error;
    auth = await call('/auth/login', { body: { email, password: PASSWORD } });
  }
  const me = await call<{ id: string; playerId: string }>('/auth/me', { token: auth.accessToken });
  return { token: auth.accessToken, email, userId: me.id, playerId: me.playerId };
}

const TEAMS = [
  ['Aurora Wolves', 'AUR'],
  ['Fjord Raiders', 'FJR'],
  ['Midnight Sun', 'MSN'],
  ['Granite Owls', 'GRO'],
  ['Polar Static', 'PLS'],
  ['Harbor Lights', 'HBL'],
  ['Copper Lynx', 'CPL'],
  ['Northbound', 'NTB'],
] as const;

async function main(): Promise<void> {
  const stamp = Date.now().toString(36).slice(-4);
  const owner = await account('owner@arenacore.local', 'Signe Lund');
  const referee = await account('referee@arenacore.local', 'Mikael Berg');
  const games = await call<{ id: string; slug: string }[]>('/games');
  const valorant = games.find((g) => g.slug === 'valorant')!.id;

  const org = await call<{ id: string }>('/orgs', {
    token: owner.token,
    body: { name: `Nordic Arena League ${stamp}` },
  });
  const invite = await call<{ token: string }>(`/orgs/${org.id}/invites`, {
    token: owner.token,
    body: { email: referee.email, role: 'REFEREE' },
  });
  await call('/invites/accept', { token: referee.token, body: { token: invite.token } });

  const teams: { id: string; captain: Session; roster: { playerId: string; role: string }[] }[] =
    [];
  for (const [i, [name, tag]] of TEAMS.entries()) {
    const members: Session[] = [];
    for (let p = 0; p < 2; p++) {
      const s = await account(
        `p${i}${p}.${stamp}@arenacore.local`,
        `${tag.toLowerCase()}_${['ace', 'blitz'][p]}${stamp.slice(0, 2)}`,
      );
      await call('/players/me/game-accounts', {
        token: s.token,
        body: {
          gameId: valorant,
          externalPlayerId: `${s.email}#VAL`,
          username: s.email.split('@')[0],
        },
      });
      members.push(s);
    }
    const team = await call<{ id: string }>('/teams', {
      token: members[0]!.token,
      body: { name: `${name} ${stamp}`, tag },
    });
    const inv = await call<{ id: string }>(`/teams/${team.id}/invites`, {
      token: members[0]!.token,
      body: { email: members[1]!.email },
    });
    await call(`/team-invites/${inv.id}/accept`, { token: members[1]!.token, method: 'POST' });
    teams.push({
      id: team.id,
      captain: members[0]!,
      roster: [
        { playerId: members[0]!.playerId, role: 'CAPTAIN' },
        { playerId: members[1]!.playerId, role: 'PLAYER' },
      ],
    });
  }

  const now = Date.now();
  const base = {
    gameId: valorant,
    region: 'EU',
    teamSize: 2,
    maxSubstitutes: 0,
    rules:
      'Best of three, finals best of five.\nCaptains report scores within 15 minutes of the end of a match.\nScreenshots of the scoreboard are required for disputes.',
    prizeInfo: '€1,000 prize pool',
  };
  const live = await call<{ id: string }>(`/orgs/${org.id}/tournaments`, {
    token: owner.token,
    body: {
      ...base,
      name: `Winter Clash ${stamp}`,
      description: 'Double-elimination playoffs for the top eight teams of the season.',
      format: 'DOUBLE_ELIMINATION',
      maxTeams: 8,
      bestOf: 3,
      finalsBestOf: 5,
      matchCheckInMinutes: 0,
      registrationOpensAt: new Date(now - 2 * HOUR).toISOString(),
      registrationClosesAt: new Date(now + HOUR).toISOString(),
      startsAt: new Date(now + 2 * HOUR).toISOString(),
    },
  });
  await call(`/orgs/${org.id}/tournaments/${live.id}/publish`, {
    token: owner.token,
    method: 'POST',
  });
  const regs: string[] = [];
  for (const t of teams) {
    const reg = await call<{ id: string }>(`/tournaments/${live.id}/registrations`, {
      token: t.captain.token,
      body: { teamId: t.id, members: t.roster, acceptRules: true, rulesVersion: 1 },
    });
    await call(`/orgs/${org.id}/tournaments/${live.id}/registrations/${reg.id}/approve`, {
      token: owner.token,
      method: 'POST',
    });
    regs.push(reg.id);
  }
  await call(`/orgs/${org.id}/tournaments/${live.id}/seeding`, {
    method: 'PUT',
    token: owner.token,
    body: { order: regs },
  });
  await call(`/orgs/${org.id}/tournaments/${live.id}/start`, {
    token: owner.token,
    method: 'POST',
  });

  const captainOf = new Map(teams.map((t, i) => [regs[i]!, t.captain]));
  type M = {
    id: string;
    key: string;
    status: string;
    a: { registrationId: string } | null;
    b: { registrationId: string } | null;
  };
  const matchByKey = async () =>
    Object.fromEntries(
      (
        await call<M[]>(`/orgs/${org.id}/tournaments/${live.id}/matches?status=READY`, {
          token: owner.token,
        })
      ).map((m) => [m.key, m]),
    );
  const play = async (key: string, a: number, b: number) => {
    const m = (await matchByKey())[key]!;
    for (const side of [m.a!, m.b!]) {
      await call(`/matches/${m.id}/results`, {
        token: captainOf.get(side.registrationId)!.token,
        body: { scoreA: a, scoreB: b },
      });
    }
  };
  await play('W1-1', 2, 0);
  await play('W1-2', 2, 1);
  await play('W1-3', 1, 2);
  await play('W1-4', 2, 0);
  await play('W2-1', 2, 1);
  await play('L1-1', 0, 2);

  // A conflicting report opens a dispute for the referee queue.
  const contested = (await matchByKey())['L1-2']!;
  await call(`/matches/${contested.id}/results`, {
    token: captainOf.get(contested.a!.registrationId)!.token,
    body: { scoreA: 2, scoreB: 1 },
  });
  await call(`/matches/${contested.id}/results`, {
    token: captainOf.get(contested.b!.registrationId)!.token,
    body: { scoreA: 1, scoreB: 2 },
  });

  const open = await call<{ id: string }>(`/orgs/${org.id}/tournaments`, {
    token: owner.token,
    body: {
      ...base,
      name: `Spring Open ${stamp}`,
      description: 'Open single-elimination cup. Any team can sign up.',
      format: 'SINGLE_ELIMINATION',
      maxTeams: 16,
      registrationOpensAt: new Date(now - HOUR).toISOString(),
      registrationClosesAt: new Date(now + 6 * 24 * HOUR).toISOString(),
      checkInOpensAt: new Date(now + 7 * 24 * HOUR - HOUR).toISOString(),
      checkInClosesAt: new Date(now + 7 * 24 * HOUR - 15 * 60_000).toISOString(),
      startsAt: new Date(now + 7 * 24 * HOUR).toISOString(),
    },
  });
  await call(`/orgs/${org.id}/tournaments/${open.id}/publish`, {
    token: owner.token,
    method: 'POST',
  });
  for (const t of teams.slice(0, 3)) {
    await call(`/tournaments/${open.id}/registrations`, {
      token: t.captain.token,
      body: { teamId: t.id, members: t.roster, acceptRules: true, rulesVersion: 1 },
    });
  }

  console.log(`Demo ready.
  Organizer: owner@arenacore.local / ${PASSWORD}
  Referee:   referee@arenacore.local / ${PASSWORD}
  Captain:   ${teams[0]!.captain.email} / ${PASSWORD}
  Console:   http://localhost:3000/console/${org.id}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
