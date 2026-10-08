import {
  Controller,
  MessageEvent,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Sse,
} from '@nestjs/common';
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

@Controller()
export class RealtimeController {
  constructor(
    private readonly realtime: RealtimeService,
    private readonly prisma: PrismaService,
  ) {}

  /** Public live feed for spectators and dashboards: "something changed, refetch X". */
  @Public()
  @Sse('tournaments/:tournamentId/stream')
  async tournament(
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
  ): Promise<Observable<MessageEvent>> {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { status: true },
    });
    if (!tournament || tournament.status === 'DRAFT')
      throw new NotFoundException('Tournament not found');
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
