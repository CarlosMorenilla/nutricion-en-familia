import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DAY_MS,
  ORIGIN,
  TOKEN_PATH,
  previousMadridDate,
  probe,
} from '../workers/garmin-personal/client';
import worker, {
  GarminProbe,
  type Env,
} from '../workers/garmin-personal/worker';

const now = new Date('2026-10-22T12:00:00Z');
const date = '2026-10-21';
const fakeKey = 'synthetic-key-not-a-credential';
const fakeToken = 'synthetic.access.token';
const successBodies = () => [
  { access_token: fakeToken },
  [
    {
      activityId: 42,
      startTimeLocal: '2026-10-20 10:00:00',
      activityName: 'PRIVATE-NAME',
      startLatitude: 10,
    },
  ],
  { calendarDate: date, totalSteps: 1234, displayName: 'PRIVATE-NAME' },
  { calendarDate: date, sleepTimeSeconds: 23000, userNote: 'PRIVATE-NOTE' },
  { hrvSummary: { calendarDate: date, lastNightAvg: 55 }, userProfilePk: 123 },
];
function transport(responses: unknown[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  return {
    calls,
    fetch: async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      assert.ok(responses.length, 'No extra requests allowed');
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response instanceof Response ? response : Response.json(response);
    },
  };
}
function privateOutput(result: unknown) {
  const text = JSON.stringify(result);
  for (const forbidden of [
    fakeKey,
    fakeToken,
    'PRIVATE-NAME',
    'PRIVATE-NOTE',
    'startLatitude',
    'userProfilePk',
    'displayName',
    '23000',
  ]) {
    assert.ok(
      !text.includes(forbidden),
      `Unexpected provider field/value: ${forbidden}`,
    );
  }
}

void test('official routes, GET-only data, bounded window, ephemeral exchange and sanitized counts', async () => {
  const mock = transport(successBodies());
  const result = await probe(fakeKey, now, mock.fetch);
  assert.equal(result.requests, 5);
  assert.equal(result.authentication.code, 'ok');
  assert.equal(result.date, date);
  assert.equal(result.activity_window_start, '2026-10-15');
  for (const resource of Object.values(result.resources)) {
    assert.equal(resource.code, 'ok');
    assert.equal(resource.observations, 1);
  }
  assert.equal(mock.calls[0].url, ORIGIN + TOKEN_PATH);
  assert.equal(mock.calls[0].init.method, 'POST');
  assert.equal(
    new Headers(mock.calls[0].init.headers).get('Authorization'),
    'ApiKey ' + fakeKey,
  );
  const urls = mock.calls.slice(1).map((c) => new URL(c.url));
  assert.equal(urls[0].searchParams.get('limit'), '3');
  assert.equal(urls[0].searchParams.get('start'), '0');
  assert.equal(urls[0].searchParams.get('endDate'), date);
  assert.equal(
    urls[1].pathname + urls[1].search,
    '/usersummary-service/usersummary/daily?calendarDate=' + date,
  );
  assert.equal(
    urls[2].pathname + urls[2].search,
    '/sleep-service/sleep/dailySleep?date=' + date,
  );
  assert.equal(urls[3].pathname, '/hrv-service/hrv/' + date);
  for (const call of mock.calls.slice(1)) {
    assert.equal(call.init.method, 'GET');
    assert.equal(new URL(call.url).origin, ORIGIN);
    assert.equal(call.init.body, undefined);
    assert.equal(call.init.redirect, 'manual');
    assert.equal(call.init.cache, 'no-store');
    assert.equal(
      new Headers(call.init.headers).get('Authorization'),
      'Bearer ' + fakeToken,
    );
  }
  privateOutput(result);
});

void test('empty data and missing metrics are distinct from zero observed measurements', async () => {
  const mock = transport([
    { accessToken: fakeToken },
    [],
    { calendarDate: date, totalSteps: 0 },
    { calendarDate: date, sleepTimeSeconds: null },
    new Response(null, { status: 204 }),
  ]);
  const result = await probe(fakeKey, now, mock.fetch);
  assert.deepEqual(result.resources.activities, {
    code: 'no_data',
    http_status: 200,
    observations: 0,
  });
  assert.equal(result.resources.daily.observations, 1);
  assert.equal(result.resources.sleep.observations, 0);
  assert.equal(result.resources.hrv.code, 'no_data');
});

for (const [status, code] of [
  [401, 'unauthorized'],
  [403, 'forbidden'],
  [429, 'rate_limited'],
  [503, 'upstream_error'],
  [302, 'unexpected_status'],
] as const) {
  void test(`authentication ${status} is sanitized and stops all reads`, async () => {
    const mock = transport([
      new Response('PRIVATE-NOTE ' + fakeKey, {
        status,
        headers: {
          'Retry-After': '3600',
          Location: 'https://untrusted.invalid',
        },
      }),
    ]);
    const result = await probe(fakeKey, now, mock.fetch);
    assert.equal(result.authentication.code, code);
    assert.equal(result.requests, 1);
    assert.equal(result.resources.activities.code, 'skipped');
    privateOutput(result);
  });
}

for (const status of [401, 403, 429, 503]) {
  void test(`resource ${status} stops subsequent requests, without retry`, async () => {
    const mock = transport([
      { access_token: fakeToken },
      new Response('PRIVATE-NOTE', {
        status,
        headers: { 'Retry-After': 'Fri, 23 Oct 2026 12:00:00 GMT' },
      }),
    ]);
    const result = await probe(fakeKey, now, mock.fetch);
    assert.equal(result.requests, 2);
    assert.equal(result.resources.daily.code, 'skipped');
    if ([429, 503].includes(status))
      assert.equal(result.resources.activities.retry_after_seconds, 86400);
    privateOutput(result);
  });
}

void test('404 is unknown availability, not proof of no data; other resources continue', async () => {
  const bodies = successBodies();
  bodies[1] = new Response('PRIVATE-NOTE', { status: 404 }) as never;
  const result = await probe(fakeKey, now, transport(bodies).fetch);
  assert.equal(result.resources.activities.code, 'not_found');
  assert.equal(result.resources.activities.observations, undefined);
  assert.equal(result.resources.hrv.code, 'ok');
});

void test('missing key makes no request; unknown token schema fails closed', async () => {
  const mock = transport([]);
  assert.equal((await probe(undefined, now, mock.fetch)).requests, 0);
  for (const body of [
    { token: fakeToken },
    { access_token: '' },
    { access_token: 'header\ninjection' },
  ]) {
    assert.equal(
      (await probe(fakeKey, now, transport([body]).fetch)).authentication.code,
      'invalid_response',
    );
  }
});

void test('HTML, invalid JSON and oversized responses never escape', async () => {
  for (const response of [
    new Response('PRIVATE-NOTE', { headers: { 'Content-Type': 'text/html' } }),
    new Response('{PRIVATE-NOTE', {
      headers: { 'Content-Type': 'application/json' },
    }),
    new Response('x'.repeat(33000), {
      headers: { 'Content-Type': 'application/json' },
    }),
    new Response('{}', {
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': '33000',
      },
    }),
  ]) {
    const result = await probe(fakeKey, now, transport([response]).fetch);
    assert.ok(
      ['invalid_response', 'response_too_large'].includes(
        result.authentication.code,
      ),
    );
    assert.equal(result.requests, 1);
    privateOutput(result);
  }
});

void test('unexpected schemas and dates do not create false observations', async () => {
  const result = await probe(
    fakeKey,
    now,
    transport([
      { access_token: fakeToken },
      { error: 'PRIVATE-NOTE' },
      { calendarDate: '2026-10-20', totalSteps: 1 },
      { calendarDate: date, sleepTimeSeconds: '23' },
      { hrvSummary: { calendarDate: date, lastNightAvg: -1 } },
    ]).fetch,
  );
  for (const resource of Object.values(result.resources)) {
    assert.equal(resource.code, 'invalid_response');
    assert.equal(resource.observations, undefined);
  }
  privateOutput(result);
});

void test('network errors cannot disclose provider URLs, keys or raw exception messages', async () => {
  const result = await probe(
    fakeKey,
    now,
    transport([new Error(fakeKey + ' PRIVATE-NOTE')]).fetch,
  );
  assert.equal(result.authentication.code, 'network_error');
  privateOutput(result);
});

void test('timeout also covers stalled body reads', async () => {
  const result = await probe(fakeKey, now, async (_url, init) => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        init.signal?.addEventListener('abort', () =>
          controller.error(new Error('PRIVATE-NOTE')),
        );
      },
    });
    return new Response(stream, {
      headers: { 'Content-Type': 'application/json' },
    });
  });
  assert.equal(result.authentication.code, 'timeout');
  privateOutput(result);
});

void test('Madrid previous complete day, including DST and year boundaries', () => {
  assert.equal(
    previousMadridDate(new Date('2026-10-21T22:30:00Z')),
    '2026-10-21',
  );
  assert.equal(
    previousMadridDate(new Date('2026-03-29T22:30:00Z')),
    '2026-03-29',
  );
  assert.equal(
    previousMadridDate(new Date('2026-10-25T23:30:00Z')),
    '2026-10-25',
  );
  assert.equal(
    previousMadridDate(new Date('2025-12-31T23:30:00Z')),
    '2025-12-31',
  );
});

interface MemoryStorage {
  get(key: string): Promise<unknown>;
  put(key: string | Record<string, unknown>, value?: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  setAlarm(value: number): Promise<void>;
  transaction<T>(fn: (tx: MemoryStorage) => Promise<T>): Promise<T>;
}
function stateMock() {
  const data = new Map<string, unknown>();
  let queue = Promise.resolve();
  let alarm = 0;
  const storage: MemoryStorage = {
    async get(key: string) {
      return data.get(key);
    },
    async put(key: string | Record<string, unknown>, value?: unknown) {
      if (typeof key === 'string') data.set(key, value);
      else for (const [k, v] of Object.entries(key)) data.set(k, v);
    },
    async delete(key: string) {
      return data.delete(key);
    },
    async setAlarm(value: number) {
      alarm = value;
    },
    transaction<T>(fn: (tx: typeof storage) => Promise<T>): Promise<T> {
      const result = queue.then(() => fn(storage));
      queue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
  return {
    data,
    alarm: () => alarm,
    state: { storage } as unknown as DurableObjectState,
  };
}

void test('durable budget survives reconstruction and serializes simultaneous probes', async () => {
  const store = stateMock();
  const env = {
    PROBE_ENABLED: 'true',
    GARMIN_PERSONAL_API_KEY: fakeKey,
  } as Env;
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return new Response('PRIVATE-NOTE', { status: 401 });
  };
  try {
    const obj = new GarminProbe(store.state, env);
    const run = () =>
      obj.fetch(new Request('https://internal/probe', { method: 'POST' }));
    const results = await Promise.all([run(), run(), run()]);
    assert.deepEqual(
      results.map((r) => r.status).sort((a, b) => a - b),
      [200, 429, 429],
    );
    assert.equal(requests, 1);
    assert.equal(
      (
        await new GarminProbe(store.state, env).fetch(
          new Request('https://internal/probe'),
        )
      ).status,
      429,
    );
    privateOutput(store.data.get('last'));
    assert.ok((store.data.get('next') as number) >= Date.now() + DAY_MS - 2000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test('Retry-After survives diagnostic expiry; disabled/missing-secret makes no call', async () => {
  const store = stateMock();
  const obj = new GarminProbe(store.state, { PROBE_ENABLED: 'false' } as Env);
  assert.equal(
    (await obj.fetch(new Request('https://internal/probe'))).status,
    409,
  );
  assert.equal(
    (
      await new GarminProbe(store.state, {
        PROBE_ENABLED: 'true',
      } as Env).fetch(new Request('https://internal/probe'))
    ).status,
    503,
  );
  const until = Date.now() + 10 * DAY_MS;
  store.data.set('next', until);
  store.data.set('last', { version: 1 });
  await obj.alarm();
  assert.equal(store.data.has('last'), false);
  assert.equal(store.alarm(), until);
  assert.equal(store.data.get('next'), until);
});

void test('public handler authenticates, rejects caller parameters/body and exposes no CORS', async () => {
  const admin = 'synthetic-administrator-token-32-characters';
  let calls = 0;
  const env = {
    PROBE_ADMIN_TOKEN: admin,
    GARMIN_PROBE: {
      idFromName: () => 'fixed',
      get: () => ({
        fetch: async () => {
          calls++;
          return Response.json({ code: 'disabled' });
        },
      }),
    },
  } as unknown as Env;
  const headers = { Authorization: 'Bearer ' + admin };
  assert.equal(
    (await worker.fetch(new Request('https://example.invalid/status'), env))
      .status,
    401,
  );
  assert.equal(
    (
      await worker.fetch(
        new Request('https://example.invalid/probe?date=2020-01-01', {
          headers,
        }),
        env,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await worker.fetch(
        new Request('https://example.invalid/probe', { headers }),
        env,
      )
    ).status,
    405,
  );
  assert.equal(
    (
      await worker.fetch(
        new Request('https://example.invalid/probe', {
          method: 'POST',
          headers,
          body: '{}',
        }),
        env,
      )
    ).status,
    400,
  );
  assert.equal(calls, 0);
  const response = await worker.fetch(
    new Request('https://example.invalid/status', { headers }),
    env,
  );
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  await worker.scheduled({} as ScheduledController, {
    ...env,
    PROBE_ENABLED: 'false',
  });
  assert.equal(calls, 1);
});

void test('deployment starts disabled, without cron, VITE secrets or Supabase write path', () => {
  const config = JSON.parse(
    readFileSync('workers/garmin-personal/wrangler.jsonc', 'utf8'),
  );
  assert.equal(config.vars.PROBE_ENABLED, 'false');
  assert.deepEqual(config.triggers.crons, []);
  assert.equal(config.observability.enabled, false);
  assert.equal(config.preview_urls, false);
  const code =
    readFileSync('workers/garmin-personal/worker.ts', 'utf8') +
    readFileSync('workers/garmin-personal/client.ts', 'utf8');
  assert.ok(
    !/VITE_|console\.|supabase|record_health_review|ingest_health_samples/.test(
      code,
    ),
  );
});
