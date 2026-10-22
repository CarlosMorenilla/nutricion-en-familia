/** Server-only probe. Never return provider bodies, tokens, identifiers or exception text. */
export const ORIGIN = 'https://personal.connectapi.garmin.com';
export const TOKEN_PATH =
  '/personalapitoken-service/personal-api/personal-api-key/token';
export const DAY_MS = 86_400_000;
export type Resource = 'activities' | 'daily' | 'sleep' | 'hrv';
export type Code =
  | 'ok'
  | 'no_data'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'upstream_error'
  | 'unexpected_status'
  | 'invalid_response'
  | 'response_too_large'
  | 'timeout'
  | 'network_error'
  | 'skipped'
  | 'not_configured';
export interface Result {
  code: Code;
  http_status?: number;
  observations?: number;
  retry_after_seconds?: number;
}
export interface ProbeResult {
  version: 1;
  source: 'Garmin Personal';
  checked_at: string;
  date: string;
  activity_window_start: string;
  activity_limit: 3;
  authentication: Result;
  resources: Record<Resource, Result>;
  requests: number;
}
type Transport = (url: string, init: RequestInit) => Promise<Response>;
type JsonObject = Record<string, unknown>;
const object = (v: unknown): v is JsonObject =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const numeric = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0;
const tokenValid = (v: unknown): v is string =>
  typeof v === 'string' &&
  v.length > 0 &&
  v.length <= 16384 &&
  /^[A-Za-z0-9._~+/-]+=*$/.test(v);

export function previousMadridDate(now: Date): string {
  const local = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return new Date(Date.parse(local + 'T12:00:00Z') - DAY_MS)
    .toISOString()
    .slice(0, 10);
}

function retryAfter(value: string | null, now: Date): number | undefined {
  if (!value) return;
  const seconds = /^\d+$/.test(value)
    ? Number(value)
    : Math.ceil((Date.parse(value) - now.getTime()) / 1000);
  if (
    Number.isFinite(seconds) &&
    seconds >= 0 &&
    seconds <= Number.MAX_SAFE_INTEGER / 1000
  )
    return seconds;
}

/** Fetch and consume within one deadline; never follow redirects with credentials. */
async function request(
  path: string,
  authorization: string,
  post: boolean,
  transport: Transport,
  now: Date,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await transport(ORIGIN + path, {
      method: post ? 'POST' : 'GET',
      headers: { Authorization: authorization, Accept: 'application/json' },
      redirect: 'manual',
      cache: 'no-store',
      signal: controller.signal,
    });
    const status = response.status;
    const result: Result = { code: 'ok', http_status: status };
    if (status !== 200) {
      result.code =
        status === 204
          ? 'no_data'
          : status === 401
            ? 'unauthorized'
            : status === 403
              ? 'forbidden'
              : status === 404
                ? 'not_found'
                : status === 429
                  ? 'rate_limited'
                  : status >= 500
                    ? 'upstream_error'
                    : 'unexpected_status';
      if (status === 429 || status === 503)
        result.retry_after_seconds = retryAfter(
          response.headers.get('Retry-After'),
          now,
        );
      await response.body?.cancel();
      return { result, data: undefined as unknown };
    }
    if (
      !/^application\/json(?:\s*;|$)/i.test(
        response.headers.get('Content-Type') ?? '',
      )
    ) {
      await response.body?.cancel();
      return {
        result: { ...result, code: 'invalid_response' as const },
        data: undefined as unknown,
      };
    }
    const maxBytes = post ? 32768 : 524288;
    if (Number(response.headers.get('Content-Length')) > maxBytes) {
      await response.body?.cancel();
      return {
        result: { ...result, code: 'response_too_large' as const },
        data: undefined as unknown,
      };
    }
    reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader)
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          return {
            result: { ...result, code: 'response_too_large' as const },
            data: undefined as unknown,
          };
        }
        chunks.push(chunk.value);
      }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return {
        result,
        data: JSON.parse(new TextDecoder().decode(bytes)) as unknown,
      };
    } catch {
      return {
        result: { ...result, code: 'invalid_response' as const },
        data: undefined as unknown,
      };
    }
  } catch {
    return {
      result: {
        code: controller.signal.aborted ? 'timeout' : 'network_error',
      } as Result,
      data: undefined as unknown,
    };
  } finally {
    clearTimeout(timeout);
    reader?.releaseLock();
  }
}

/** Count only validated summaries; missing/null metrics never become zero measurements. */
function observations(
  kind: Resource,
  data: unknown,
  date: string,
  start: string,
): number | null {
  if (data === null) return 0;
  if (kind === 'activities') {
    if (!Array.isArray(data) || data.length > 3) return null;
    if (
      !data.every(
        (v) =>
          object(v) &&
          numeric(v.activityId) &&
          typeof v.startTimeLocal === 'string' &&
          /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(v.startTimeLocal) &&
          v.startTimeLocal.slice(0, 10) >= start &&
          v.startTimeLocal.slice(0, 10) <= date,
      )
    )
      return null;
    return data.length;
  }
  if (!object(data)) return null;
  if (!Object.keys(data).length) return 0;
  if (kind === 'hrv') {
    if (data.hrvSummary === null) return 0;
    if (!object(data.hrvSummary) || data.hrvSummary.calendarDate !== date)
      return null;
    return numeric(data.hrvSummary.lastNightAvg)
      ? 1
      : data.hrvSummary.lastNightAvg == null
        ? 0
        : null;
  }
  if (data.calendarDate !== date) return null;
  const field = kind === 'daily' ? 'totalSteps' : 'sleepTimeSeconds';
  return numeric(data[field]) ? 1 : data[field] == null ? 0 : null;
}

export async function probe(
  apiKey: string | undefined,
  now = new Date(),
  transport: Transport = fetch,
): Promise<ProbeResult> {
  const date = previousMadridDate(now);
  const start = new Date(Date.parse(date + 'T12:00:00Z') - 6 * DAY_MS)
    .toISOString()
    .slice(0, 10);
  const report: ProbeResult = {
    version: 1,
    source: 'Garmin Personal',
    checked_at: now.toISOString(),
    date,
    activity_window_start: start,
    activity_limit: 3,
    authentication: { code: 'not_configured' },
    resources: {
      activities: { code: 'skipped' },
      daily: { code: 'skipped' },
      sleep: { code: 'skipped' },
      hrv: { code: 'skipped' },
    },
    requests: 0,
  };
  if (!apiKey || apiKey.length > 4096 || /\s/.test(apiKey)) return report;
  report.requests++;
  const auth = await request(
    TOKEN_PATH,
    'ApiKey ' + apiKey,
    true,
    transport,
    now,
  );
  report.authentication = auth.result;
  if (auth.result.code !== 'ok') return report;
  // FAQ documents the exchange but not the response schema. Fail closed on unknown formats.
  const token = object(auth.data)
    ? (auth.data.access_token ?? auth.data.accessToken)
    : undefined;
  if (!tokenValid(token)) {
    report.authentication.code = 'invalid_response';
    return report;
  }
  const routes: [Resource, string][] = [
    [
      'activities',
      `/activitylist-service/activities/search/activities?start=0&limit=3&sortOrder=desc&sortBy=startLocal&excludeChildren=true&startDate=${start}&endDate=${date}`,
    ],
    ['daily', `/usersummary-service/usersummary/daily?calendarDate=${date}`],
    ['sleep', `/sleep-service/sleep/dailySleep?date=${date}`],
    ['hrv', `/hrv-service/hrv/${date}`],
  ];
  for (const [kind, path] of routes) {
    report.requests++;
    const response = await request(
      path,
      'Bearer ' + token,
      false,
      transport,
      now,
    );
    const result = response.result;
    if (result.code === 'ok') {
      const count = observations(kind, response.data, date, start);
      if (count === null) result.code = 'invalid_response';
      else {
        result.observations = count;
        if (!count) result.code = 'no_data';
      }
    } else if (result.code === 'no_data') result.observations = 0;
    report.resources[kind] = result;
    if (
      [
        'unauthorized',
        'forbidden',
        'rate_limited',
        'upstream_error',
        'timeout',
        'network_error',
      ].includes(result.code)
    )
      break;
  }
  return report;
}
