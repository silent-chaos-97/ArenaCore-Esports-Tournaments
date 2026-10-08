import { randomBytes } from 'node:crypto';
import { DomainError } from '../../../common/errors/domain-error.js';
import { gameResultWebhookSchema, type GameResultWebhookInput } from '@arenacore/shared';

export interface LobbyInfo {
  externalMatchId: string;
  joinCode?: string;
  serverRegion?: string;
}

/**
 * Integration boundary for publisher APIs (spec §9). The platform never talks to a game API
 * directly; each provider implements what it supports and reports the rest as unsupported.
 */
export interface GameProviderAdapter {
  readonly key: string;
  readonly trustedResults: boolean;
  createLobby(input: { matchId: string; region?: string | null }): Promise<LobbyInfo>;
  getMatch?(externalMatchId: string): Promise<unknown>;
  verifyPlayer?(externalPlayerId: string): Promise<boolean>;
  getMatchResult?(externalMatchId: string): Promise<GameResultWebhookInput | null>;
  getPlayerStats?(externalPlayerId: string): Promise<Record<string, number>>;
  parseResultWebhook(body: unknown): GameResultWebhookInput;
}

/** Default for games without an API: organizers create lobbies by hand, captains report scores. */
export class ManualProvider implements GameProviderAdapter {
  readonly key: string = 'manual';
  readonly trustedResults: boolean = false;

  async createLobby(input: { matchId: string; region?: string | null }): Promise<LobbyInfo> {
    return {
      externalMatchId: `manual-${input.matchId}`,
      joinCode: randomBytes(4).toString('hex').toUpperCase(),
      serverRegion: input.region ?? undefined,
    };
  }

  parseResultWebhook(_body: unknown): GameResultWebhookInput {
    throw new DomainError(
      'WEBHOOKS_UNSUPPORTED',
      'This provider does not deliver result webhooks',
      400,
    );
  }
}

/** Generic signed-webhook provider used by tournament servers and test harnesses. */
export class GenericWebhookProvider extends ManualProvider {
  override readonly key: string = 'generic';
  override readonly trustedResults: boolean = true;

  override parseResultWebhook(body: unknown): GameResultWebhookInput {
    return gameResultWebhookSchema.parse(body);
  }
}

/** Riot exposes tournament codes and result callbacks; wired up post-MVP behind this adapter. */
export class RiotLolProvider extends GenericWebhookProvider {
  override readonly key = 'riot-lol';
}

export class GameProviderRegistry {
  private readonly providers = new Map<string, GameProviderAdapter>();

  constructor(
    adapters: GameProviderAdapter[] = [
      new ManualProvider(),
      new GenericWebhookProvider(),
      new RiotLolProvider(),
    ],
  ) {
    for (const a of adapters) this.providers.set(a.key, a);
  }

  get(key: string): GameProviderAdapter | undefined {
    return this.providers.get(key);
  }

  forGame(providerKey: string): GameProviderAdapter {
    return this.providers.get(providerKey) ?? this.providers.get('manual')!;
  }
}
