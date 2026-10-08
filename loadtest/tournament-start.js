/**
 * k6 load test for the "high-concurrency tournament start" scenario (spec §19.3): thousands of
 * players and spectators refreshing brackets, schedules and their next match at the same time.
 *
 *   k6 run -e BASE=http://localhost:4000/api/v1 -e SLUG=<tournament-slug> loadtest/tournament-start.js
 *
 * Optional: -e TOKENS=token1,token2,... to include authenticated "my next match" traffic.
 * Thresholds mirror the spec's proposed targets (API p95 < 300 ms, search p95 < 500 ms).
 * Run the API with DISABLE_RATE_LIMIT=true, otherwise per-IP limits dominate the result.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE || 'http://localhost:4000/api/v1';
const SLUG = __ENV.SLUG;
const TOKENS = (__ENV.TOKENS || '').split(',').filter(Boolean);

export const options = {
  scenarios: {
    spectators: {
      executor: 'ramping-vus',
      exec: 'spectator',
      stages: [
        { duration: '30s', target: 500 },
        { duration: '1m', target: 2000 },
        { duration: '30s', target: 0 },
      ],
    },
    discovery: {
      executor: 'constant-arrival-rate',
      exec: 'search',
      rate: 50,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 50,
    },
    players: TOKENS.length
      ? {
          executor: 'constant-vus',
          exec: 'player',
          vus: Math.min(TOKENS.length, 500),
          duration: '2m',
        }
      : { executor: 'constant-vus', exec: 'noop', vus: 1, duration: '1s' },
  },
  thresholds: {
    'http_req_duration{kind:read}': ['p(95)<300'],
    'http_req_duration{kind:search}': ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

export function spectator() {
  const views = ['bracket', 'standings', 'matches?phase=upcoming', ''];
  const view = views[Math.floor(Math.random() * views.length)];
  const res = http.get(`${BASE}/public/tournaments/${SLUG}${view ? `/${view}` : ''}`, {
    tags: { kind: 'read' },
  });
  check(res, { 'read ok': (r) => r.status === 200 });
  sleep(2 + Math.random() * 3);
}

export function search() {
  const terms = ['cup', 'open', 'spring', 'eu', 'clash', 'val'];
  const res = http.get(
    `${BASE}/public/tournaments?q=${terms[Math.floor(Math.random() * terms.length)]}`,
    { tags: { kind: 'search' } },
  );
  check(res, { 'search ok': (r) => r.status === 200 });
}

export function player() {
  const token = TOKENS[(__VU - 1) % TOKENS.length];
  const res = http.get(`${BASE}/matches/mine`, {
    headers: { authorization: `Bearer ${token}` },
    tags: { kind: 'read' },
  });
  check(res, { 'next match ok': (r) => r.status === 200 });
  sleep(5);
}

export function noop() {}
