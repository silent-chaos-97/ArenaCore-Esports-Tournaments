import { Controller, Get, Header, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  discoverTournamentsQuerySchema,
  publicMatchesQuerySchema,
  searchQuerySchema,
  type DiscoverTournamentsQuery,
  type SearchQuery,
} from '@arenacore/shared';
import { Public } from '../../common/auth/decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.js';
import { PublicService } from './public.service.js';

const slugParam = 'slug';

@Public()
@RateLimit({ limit: 600, windowSeconds: 60 })
@Controller('public')
export class PublicController {
  constructor(private readonly publicReads: PublicService) {}

  @Get('tournaments')
  @Header('Cache-Control', 'public, max-age=15')
  discover(
    @Query(new ZodValidationPipe(discoverTournamentsQuerySchema)) query: DiscoverTournamentsQuery,
  ) {
    return this.publicReads.discover(query);
  }

  @Get('tournaments/:slug')
  @Header('Cache-Control', 'public, max-age=10')
  tournament(@Param(slugParam) slug: string) {
    return this.publicReads.tournament(slug);
  }

  @Get('tournaments/:slug/teams')
  teams(@Param(slugParam) slug: string) {
    return this.publicReads.teams(slug);
  }

  @Get('tournaments/:slug/bracket')
  @Header('Cache-Control', 'public, max-age=5')
  bracket(@Param(slugParam) slug: string) {
    return this.publicReads.bracket(slug);
  }

  @Get('tournaments/:slug/standings')
  @Header('Cache-Control', 'public, max-age=5')
  standings(@Param(slugParam) slug: string) {
    return this.publicReads.standings(slug);
  }

  @Get('tournaments/:slug/matches')
  @Header('Cache-Control', 'public, max-age=5')
  matches(
    @Param(slugParam) slug: string,
    @Query(new ZodValidationPipe(publicMatchesQuerySchema))
    query: { phase?: 'upcoming' | 'live' | 'completed' },
  ) {
    return this.publicReads.matches(slug, query.phase);
  }

  @Get('teams')
  searchTeams(@Query(new ZodValidationPipe(searchQuerySchema)) query: SearchQuery) {
    return this.publicReads.searchTeams(query);
  }

  @Get('teams/:teamId')
  team(@Param('teamId', ParseUUIDPipe) teamId: string) {
    return this.publicReads.team(teamId);
  }

  @Get('players')
  searchPlayers(@Query(new ZodValidationPipe(searchQuerySchema)) query: SearchQuery) {
    return this.publicReads.searchPlayers(query);
  }

  @Get('orgs/:slug/leaderboard')
  @Header('Cache-Control', 'public, max-age=30')
  leaderboard(@Param(slugParam) slug: string) {
    return this.publicReads.leaderboard(slug);
  }
}
