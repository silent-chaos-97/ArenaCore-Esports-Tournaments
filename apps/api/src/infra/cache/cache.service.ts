import { Global, Inject, Injectable, Module, Optional } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { MetricsService } from '../../modules/metrics/metrics.module.js';
import { REDIS } from '../redis.module.js';

/**
 * Read-through cache for public read models. Keys are versioned per tournament: bumping the
 * version on a live event invalidates every cached view of that tournament at once.
 */
@Injectable()
export class CacheService {
  hits = 0;
  misses = 0;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  async getOrSet<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
    const cached = await this.redis.get(key);
    if (cached !== null) {
      this.hits += 1;
      this.metrics?.cacheRequests.inc({ result: 'hit' });
      return JSON.parse(cached) as T;
    }
    this.misses += 1;
    this.metrics?.cacheRequests.inc({ result: 'miss' });
    const value = await load();
    await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    return value;
  }

  async tournamentVersion(tournamentId: string): Promise<string> {
    return (await this.redis.get(`cache:tv:${tournamentId}`)) ?? '0';
  }

  async bumpTournament(tournamentId: string): Promise<void> {
    await this.redis
      .multi()
      .incr(`cache:tv:${tournamentId}`)
      .expire(`cache:tv:${tournamentId}`, 7 * 86400)
      .exec();
  }
}

@Global()
@Module({ providers: [CacheService], exports: [CacheService] })
export class CacheModule {}
