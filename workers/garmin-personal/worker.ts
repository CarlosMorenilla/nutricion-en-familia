import { DAY_MS, probe, type ProbeResult } from './client';

export interface Env {
  GARMIN_PERSONAL_API_KEY?: string;
  PROBE_ADMIN_TOKEN?: string;
  PROBE_ENABLED?: string;
  GARMIN_PROBE: DurableObjectNamespace;
}
const json = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });

async function authorized(request: Request, secret: string | undefined) {
  if (!secret || secret.length < 32 || secret.length > 512) return false;
  const header = request.headers.get('Authorization') ?? '';
  if (header.length > 1024) return false;
  const digest = (value: string) =>
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const [a, b] = await Promise.all([
    digest(header),
    digest('Bearer ' + secret),
  ]);
  const av = new Uint8Array(a),
    bv = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < av.length; i++) difference |= av[i] ^ bv[i];
  return difference === 0;
}
function instance(env: Env) {
  // One object globally, shared by manual and scheduled invocations. No account IDs.
  return env.GARMIN_PROBE.get(env.GARMIN_PROBE.idFromName('personal-probe-v1'));
}

async function hasBody(request: Request) {
  if (request.body === null) return false;
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // workerd exposes a stream even for an empty POST. Read only its first chunk.
    const first = await Promise.race([
      reader.read(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('body_timeout')), 2000);
      }),
    ]);
    return !first.done;
  } finally {
    clearTimeout(timer);
    await reader.cancel();
    reader.releaseLock();
  }
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.search || !['/probe', '/status'].includes(url.pathname))
        return json({ code: 'not_found' }, 404);
      if (!(await authorized(request, env.PROBE_ADMIN_TOKEN)))
        return json({ code: 'unauthorized' }, 401);
      if (
        (url.pathname === '/probe' && request.method !== 'POST') ||
        (url.pathname === '/status' && request.method !== 'GET')
      )
        return json({ code: 'method_not_allowed' }, 405);
      // No dates, URLs, credentials or configuration accepted from callers.
      if (await hasBody(request))
        return json({ code: 'body_not_allowed' }, 400);
      return await instance(env).fetch(
        new Request('https://internal' + url.pathname, {
          method: request.method,
        }),
      );
    } catch {
      return json({ code: 'internal_error' }, 503);
    }
  },
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    if (env.PROBE_ENABLED !== 'true') return;
    try {
      await instance(env).fetch(
        new Request('https://internal/probe', { method: 'POST' }),
      );
    } catch {
      /* Deliberately no provider exceptions or automatic retries in logs. */
    }
  },
};
export default worker;

/** Stores only the last sanitized diagnostic and a durable request budget, never raw data/tokens. */
export class GarminProbe {
  constructor(
    private state: DurableObjectState,
    private env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    try {
      if (new URL(request.url).pathname === '/status') {
        const last = await this.state.storage.get<ProbeResult>('last');
        return json({
          code: 'status',
          enabled: this.env.PROBE_ENABLED === 'true',
          last:
            last && Date.now() - Date.parse(last.checked_at) < 7 * DAY_MS
              ? last
              : null,
          next_allowed_at:
            (await this.state.storage.get<number>('next')) ?? null,
        });
      }
      if (this.env.PROBE_ENABLED !== 'true')
        return json({ code: 'disabled' }, 409);
      if (!this.env.GARMIN_PERSONAL_API_KEY)
        return json({ code: 'not_configured' }, 503);
      const now = Date.now();
      // Reserve before network I/O: concurrent calls and object restarts cannot double-spend.
      const admitted = await this.state.storage.transaction(async (tx) => {
        if (((await tx.get<number>('next')) ?? 0) > now) return false;
        await tx.put('next', now + DAY_MS);
        await tx.put('last', null);
        await tx.setAlarm(now + 7 * DAY_MS);
        return true;
      });
      if (!admitted) return json({ code: 'cooldown' }, 429);
      const report = await probe(
        this.env.GARMIN_PERSONAL_API_KEY,
        new Date(now),
      );
      const backoff = Math.max(
        0,
        report.authentication.retry_after_seconds ?? 0,
        ...Object.values(report.resources).map(
          (r) => r.retry_after_seconds ?? 0,
        ),
      );
      const next = Math.max(now + DAY_MS, Date.now() + backoff * 1000);
      await this.state.storage.put({ last: report, next });
      // Retain a longer Retry-After budget even after deleting the diagnostic.
      await this.state.storage.setAlarm(now + 7 * DAY_MS);
      return json(report);
    } catch {
      return json({ code: 'internal_error' }, 503);
    }
  }

  async alarm(): Promise<void> {
    await this.state.storage.delete('last');
    const next = (await this.state.storage.get<number>('next')) ?? 0;
    if (next <= Date.now()) await this.state.storage.delete('next');
    else await this.state.storage.setAlarm(next);
  }
}
