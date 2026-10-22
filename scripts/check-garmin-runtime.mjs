// Offline workerd test using the Miniflare version already pinned by Wrangler's lockfile.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const config = JSON.parse(readFileSync('workers/garmin-personal/wrangler.jsonc', 'utf8'));
const admin = 'synthetic-admin-token-with-32-characters';
const calls = [];
const mf = new Miniflare(convertV4MiniflareOptions({
  modules: true,
  scriptPath: 'workers/garmin-personal/.wrangler/garmin-build/worker.js',
  compatibilityDate: config.compatibility_date,
  bindings: { PROBE_ENABLED: 'true', PROBE_ADMIN_TOKEN: admin, GARMIN_PERSONAL_API_KEY: 'synthetic-only' },
  durableObjects: { GARMIN_PROBE: { className: 'GarminProbe', useSQLite: true } },
  outboundService: request => {
    // All outbound requests terminate here; there is no real external network fallback.
    const url = new URL(request.url);
    assert.equal(url.origin, 'https://personal.connectapi.garmin.com');
    calls.push(url.pathname);
    let body;
    if (url.pathname.endsWith('/token')) {
      assert.equal(request.method, 'POST');
      assert.equal(request.headers.get('Authorization'), 'ApiKey synthetic-only');
      body = { access_token: 'synthetic.access.token' };
    } else {
      assert.equal(request.method, 'GET');
      assert.equal(request.headers.get('Authorization'), 'Bearer synthetic.access.token');
      if (url.pathname.startsWith('/activitylist-service/')) body = [{ activityId: 1, startTimeLocal: url.searchParams.get('endDate') + ' 10:00:00' }];
      else if (url.pathname.startsWith('/usersummary-service/')) body = { calendarDate: url.searchParams.get('calendarDate'), totalSteps: 10 };
      else if (url.pathname.startsWith('/sleep-service/')) body = { calendarDate: url.searchParams.get('date'), sleepTimeSeconds: 100 };
      else if (url.pathname.startsWith('/hrv-service/')) body = { hrvSummary: { calendarDate: url.pathname.split('/').at(-1), lastNightAvg: 50 } };
      else throw new Error('Unexpected outbound request');
    }
    return Response.json(body);
  },
}));
try {
  const headers = { Authorization: 'Bearer ' + admin };
  assert.equal((await mf.dispatchFetch('https://example.invalid/status')).status, 401);
  const responses = await Promise.all([1, 2, 3].map(() => mf.dispatchFetch('https://example.invalid/probe', { method: 'POST', headers })));
  assert.deepEqual(responses.map(r => r.status).sort((a, b) => a - b), [200, 429, 429]);
  const report = await responses.find(r => r.status === 200).json();
  assert.equal(report.authentication.code, 'ok');
  assert.equal(report.requests, 5);
  for (const resource of Object.values(report.resources)) assert.equal(resource.observations, 1);
  assert.equal(calls.length, 5);
  const status = await (await mf.dispatchFetch('https://example.invalid/status', { headers })).json();
  assert.deepEqual(status.last, report);
  assert.ok(!JSON.stringify(status).includes('synthetic'));
  assert.equal(calls.length, 5, 'Reading status must not call Garmin');
  console.log('Cloudflare runtime: authentication, 4 mocked reads, SQLite concurrency and private status passed; no external requests.');
} finally {
  await mf.dispose();
}
