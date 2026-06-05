/**
 * k6 Load Test — ThrottleX Distributed Rate Limiter
 *
 * Run:
 *   k6 run tests/load/k6-script.js
 *   k6 run --env BASE_URL=http://localhost:3000 tests/load/k6-script.js
 *
 * Requires k6 >= 0.45.0  (https://k6.io/docs/getting-started/installation/)
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Counter, Trend } from 'k6/metrics';

// ─── Custom metrics ───────────────────────────────────────────────────────────

const allowedRate    = new Rate('throttlex_allowed_rate');
const rejectedRate   = new Rate('throttlex_rejected_rate');
const checkDuration  = new Trend('throttlex_check_duration_ms', true);
const totalRequests  = new Counter('throttlex_total_requests');

// ─── Test configuration ───────────────────────────────────────────────────────

export const options = {
  scenarios: {
    // Steady-state load: 200 req/s for 30 s
    steady_load: {
      executor: 'constant-arrival-rate',
      rate: 200,
      timeUnit: '1s',
      duration: '30s',
      preAllocatedVUs: 50,
      maxVUs: 150,
      startTime: '0s',
    },

    // Spike test: ramp to 2 000 req/s then recover
    spike: {
      executor: 'ramping-arrival-rate',
      startRate: 50,
      timeUnit: '1s',
      stages: [
        { duration: '10s', target: 50 },
        { duration: '5s',  target: 2000 },
        { duration: '10s', target: 50 },
      ],
      preAllocatedVUs: 300,
      maxVUs: 800,
      startTime: '35s',
    },

    // Concurrency test: many VUs hammering the same key
    concurrency: {
      executor: 'constant-vus',
      vus: 100,
      duration: '15s',
      startTime: '65s',
    },
  },

  thresholds: {
    http_req_duration:          ['p(95)<150', 'p(99)<400'],
    http_req_failed:            ['rate<0.005'],
    throttlex_check_duration_ms: ['p(95)<120'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

// ─── Setup: seed rate-limit configs ───────────────────────────────────────────

export function setup() {
  const configs = [
    {
      key: 'k6-high-volume',
      algorithm: 'sliding-window-counter',
      limit: 100_000,
      windowMs: 60_000,
      scope: 'user',
      description: 'k6 high-volume test user',
    },
    {
      key: 'k6-low-volume',
      algorithm: 'fixed-window',
      limit: 3,
      windowMs: 60_000,
      scope: 'user',
      description: 'k6 intentionally restrictive user',
    },
    {
      key: 'k6-token-bucket',
      algorithm: 'token-bucket',
      limit: 1_000,
      windowMs: 1_000,
      refillRate: 1_000,
      burstCapacity: 2_000,
      scope: 'api-key',
      description: 'k6 token-bucket test key',
    },
    {
      key: 'k6-swlog',
      algorithm: 'sliding-window-log',
      limit: 50_000,
      windowMs: 60_000,
      scope: 'user',
      description: 'k6 sliding-window-log test',
    },
  ];

  for (const cfg of configs) {
    const res = http.post(`${BASE_URL}/config`, JSON.stringify(cfg), { headers: JSON_HEADERS });
    if (res.status !== 201) {
      console.warn(`Failed to seed config for key=${cfg.key}: ${res.status}`);
    }
  }
}

// ─── Default function (called per VU iteration) ───────────────────────────────

export default function () {
  const scenarios = [
    checkKey('k6-high-volume',  '/api/v1/data',     1),
    checkKey('k6-low-volume',   '/api/v1/payments', 1),
    checkKey('k6-token-bucket', '/api/v1/stream',   5),
    checkKey('k6-swlog',        '/api/v1/search',   1),
    healthProbe(),
  ];

  const pick = scenarios[Math.floor(Math.random() * scenarios.length)];
  pick();

  sleep(0.01); // 10 ms think time
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function checkKey(key, endpoint, tokens) {
  return () => {
    const payload = JSON.stringify({ key, endpoint, tokens });
    const start   = Date.now();
    const res     = http.post(`${BASE_URL}/check`, payload, { headers: JSON_HEADERS });
    const elapsed = Date.now() - start;

    checkDuration.add(elapsed);
    totalRequests.add(1);

    const ok = check(res, {
      'status is 200 or 429':        (r) => r.status === 200 || r.status === 429,
      'body.allowed is boolean':      (r) => typeof JSON.parse(r.body).allowed === 'boolean',
      'body.remaining >= 0':          (r) => JSON.parse(r.body).remaining >= 0,
      'X-RateLimit-Limit present':    (r) => Boolean(r.headers['X-RateLimit-Limit']),
      'X-RateLimit-Reset present':    (r) => Boolean(r.headers['X-RateLimit-Reset']),
    });

    if (!ok) console.error(`check failed: key=${key} status=${res.status}`);

    if (res.status === 200) allowedRate.add(true);
    else if (res.status === 429) rejectedRate.add(true);
  };
}

function healthProbe() {
  return () => {
    const res = http.get(`${BASE_URL}/health`);
    check(res, { 'health 200': (r) => r.status === 200 });
  };
}

// ─── Teardown ─────────────────────────────────────────────────────────────────

export function teardown() {
  const keys = ['k6-high-volume', 'k6-low-volume', 'k6-token-bucket', 'k6-swlog'];
  for (const key of keys) {
    http.del(`${BASE_URL}/config/${key}`);
  }
}
