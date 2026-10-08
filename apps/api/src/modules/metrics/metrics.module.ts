import {
  CallHandler,
  Global,
  Controller,
  ExecutionContext,
  Get,
  Header,
  Injectable,
  Module,
  NestInterceptor,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import type { Request, Response } from 'express';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';
import { finalize, Observable } from 'rxjs';
import { Public } from '../../common/auth/decorators.js';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  readonly httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request latency',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.01, 0.025, 0.05, 0.1, 0.3, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });

  readonly cacheRequests = new Counter({
    name: 'cache_requests_total',
    help: 'Public read-model cache lookups',
    labelNames: ['result'] as const,
    registers: [this.registry],
  });

  readonly webhookRequests = new Counter({
    name: 'game_webhook_requests_total',
    help: 'Game provider result callbacks by outcome',
    labelNames: ['provider', 'outcome'] as const,
    registers: [this.registry],
  });

  readonly relayLag = new Histogram({
    name: 'outbox_relay_lag_seconds',
    help: 'Time from a state change committing to its event being relayed (match-processing lag)',
    buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60],
    registers: [this.registry],
  });

  readonly notificationDeliveries = new Counter({
    name: 'notification_deliveries_total',
    help: 'Notification deliveries by channel and outcome',
    labelNames: ['channel', 'status'] as const,
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }

  /** Registers a gauge whose value is read at scrape time (queue depth, backlog, ...). */
  gauge(
    name: string,
    help: string,
    read: () => Promise<number | Record<string, number>>,
    labelName = 'name',
  ): void {
    if (this.registry.getSingleMetric(name)) return;
    new Gauge({
      name,
      help,
      labelNames: [labelName],
      registers: [this.registry],
      async collect() {
        const value = await read().catch(() => -1);
        if (typeof value === 'number') this.set(value);
        else for (const [label, v] of Object.entries(value)) this.set({ [labelName]: label }, v);
      },
    });
  }
}

@Injectable()
class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const end = this.metrics.httpDuration.startTimer({ method: req.method });
    return next.handle().pipe(
      finalize(() =>
        end({
          route: (req.route as { path?: string } | undefined)?.path ?? 'unknown',
          status: res.statusCode,
        }),
      ),
    );
  }
}

@Public()
@Controller()
class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get('metrics')
  @Header('Cache-Control', 'no-store')
  async metricsText(): Promise<string> {
    return this.metrics.registry.metrics();
  }
}

@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService, { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor }],
  exports: [MetricsService],
})
export class MetricsModule {}
