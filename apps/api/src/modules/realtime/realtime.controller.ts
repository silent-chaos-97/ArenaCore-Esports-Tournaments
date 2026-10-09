import {
  CanActivate,
  Controller,
  ExecutionContext,
  Injectable,
  MessageEvent,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Sse,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { interval, map, merge, Observable } from 'rxjs';
import type { AuthUser } from '../../common/auth/auth.types.js';
import { CurrentUser, Public } from '../../common/auth/decorators.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { RealtimeService } from './realtime.service.js';

const HEARTBEAT_MS = 25_000;
const heartbeat = () =>
  interval(HEARTBEAT_MS).pipe(
    map((): MessageEvent => ({ type: 'ping', data: { at: new Date().toISOString() } })),
  );

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Rejects unknown and draft tournaments before the SSE response starts. Throwing from an async
 * @Sse handler races the 200 text/event-stream headers, so the check must happen in a guard.
 */
@Injectable()
class PublishedTournamentGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const id = context.switchToHttp().getRequest<Request>().params.tournamentId;
    const tournament =
      typeof id === 'string' && UUID.test(id)
        ? await this.prisma.tournament.findUnique({ where: { id }, select: { status: true } })
        : null;
    if (!tournament || tournament.status === 'DRAFT') {
      throw new NotFoundException('Tournament not found');
    }
    return true;
  }
}

@Controller()
export class RealtimeController {
  constructor(private readonly realtime: RealtimeService) {}

  /** Public live feed for spectators and dashboards: "something changed, refetch X". */
  @Public()
  @UseGuards(PublishedTournamentGuard)
  @Sse('tournaments/:tournamentId/stream')
  tournament(@Param('tournamentId', ParseUUIDPipe) tournamentId: string): Observable<MessageEvent> {
    const events = this.realtime
      .tournament$(tournamentId)
      .pipe(map((e): MessageEvent => ({ type: e.type, data: e })));
    return merge(events, heartbeat());
  }

  /** Private feed of the caller's notifications (EventSource passes ?access_token=). */
  @Sse('me/stream')
  me(@CurrentUser() user: AuthUser): Observable<MessageEvent> {
    const notifications = this.realtime
      .user$(user.id)
      .pipe(map((n): MessageEvent => ({ type: 'notification', data: n })));
    return merge(notifications, heartbeat());
  }
}
