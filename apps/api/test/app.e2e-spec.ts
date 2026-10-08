import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './utils/app.js';

describe('API skeleton', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('reports liveness and readiness', async () => {
    await request(app.getHttpServer()).get('/api/v1/health').expect(200, { status: 'ok' });
    const ready = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
    expect(ready.body.checks.redis).toBe('up');
  });

  it('echoes a valid inbound request id and generates one otherwise', async () => {
    const echoed = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('x-request-id', 'test-request-123');
    expect(echoed.headers['x-request-id']).toBe('test-request-123');
    const generated = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('x-request-id', 'bad id!');
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('renders errors as problem+json with the request id', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/nope').expect(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({ status: 404, instance: '/api/v1/nope' });
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });

  it('exposes prometheus metrics outside the api prefix', async () => {
    await request(app.getHttpServer()).get('/api/v1/health');
    const res = await request(app.getHttpServer()).get('/metrics').expect(200);
    expect(res.text).toContain('http_request_duration_seconds');
  });
});
