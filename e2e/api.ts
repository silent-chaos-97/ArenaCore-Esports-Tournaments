/** Thin HTTP helpers for setting up the parts of the scenario that aren't under test in the UI. */
export const API = process.env.E2E_API_URL ?? 'http://localhost:4000/api/v1';
export const PASSWORD = 'e2e-password-123';

export async function call<T>(
  path: string,
  init: { method?: string; body?: unknown; token?: string } = {},
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: {
      'content-type': 'application/json',
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → ${res.status} ${text}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

export interface Captain {
  email: string;
  token: string;
  teamId: string;
  teamName: string;
  playerId: string;
}

/** A one-player team whose captain has linked a game account. */
export async function captainWithTeam(
  tag: string,
  run: string,
  gameSlug = 'valorant',
): Promise<Captain> {
  const email = `${tag.toLowerCase()}.${run}@e2e.arenacore.local`;
  const { accessToken: token } = await call<{ accessToken: string }>('/auth/register', {
    body: { email, password: PASSWORD, displayName: `${tag} captain` },
  });
  const me = await call<{ playerId: string }>('/auth/me', { token });
  const games = await call<{ id: string; slug: string }[]>('/games');
  await call('/players/me/game-accounts', {
    token,
    body: {
      gameId: games.find((g) => g.slug === gameSlug)!.id,
      externalPlayerId: `${email}#E2E`,
      username: `${tag}${run}`,
    },
  });
  const teamName = `${tag} ${run}`;
  const team = await call<{ id: string }>('/teams', { token, body: { name: teamName } });
  return { email, token, teamId: team.id, teamName, playerId: me.playerId };
}
