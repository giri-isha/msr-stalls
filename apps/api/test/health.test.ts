import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildApp } from '../src/app';
import { resetDatabase, seedEdition } from './helpers/db';

let app: FastifyInstance;
beforeAll(async () => {
  await resetDatabase();
  await seedEdition();
  app = await buildApp({ logger: false });
});
afterAll(async () => {
  await app.close();
});

describe('GET /health', () => {
  test('reports ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });
});

describe('the stalls module is mounted', () => {
  test('its public config route answers without a session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/m/stalls/public/config' });
    expect(res.statusCode).toBe(200);
    expect(res.json().edition.year).toBe(2026);
  });

  test('its backoffice routes refuse a caller with no session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/m/stalls/requests' });
    expect(res.statusCode).toBe(401);
  });
});
