/** Supported-game catalog shared by the seed script and integration tests. */
export const GAME_CATALOG = [
  { slug: 'league-of-legends', name: 'League of Legends', providerKey: 'riot-lol' },
  { slug: 'valorant', name: 'VALORANT', providerKey: 'manual' },
  { slug: 'counter-strike-2', name: 'Counter-Strike 2', providerKey: 'manual' },
  { slug: 'dota-2', name: 'Dota 2', providerKey: 'manual' },
  { slug: 'rocket-league', name: 'Rocket League', providerKey: 'manual' },
] as const;
