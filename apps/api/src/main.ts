import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { ApiEnv } from '@arenacore/shared';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { configureApp } from './bootstrap.js';
import { API_ENV } from './config/config.module.js';

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  app.useLogger(app.get(Logger));
  configureApp(app);
  const env = app.get<ApiEnv>(API_ENV);
  await app.listen(env.API_PORT);
}

void main();
