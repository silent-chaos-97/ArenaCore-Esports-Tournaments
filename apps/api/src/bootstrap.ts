import type { INestApplication } from '@nestjs/common';
import { RequestMethod } from '@nestjs/common';
import type { ApiEnv } from '@arenacore/shared';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { requestContextMiddleware } from './common/context/request-context.js';
import { API_ENV } from './config/config.module.js';

/** Shared HTTP setup for main.ts and integration tests. */
export function configureApp(app: INestApplication): INestApplication {
  const env = app.get<ApiEnv>(API_ENV);
  app.use(requestContextMiddleware);
  // API responses are JSON/SSE only; the web app is served from its own origin.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1', { exclude: [{ path: 'metrics', method: RequestMethod.GET }] });
  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });
  app.enableShutdownHooks();
  return app;
}
