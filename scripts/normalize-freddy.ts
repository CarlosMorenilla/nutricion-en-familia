/** Normalize a saved Freddy query_metrics tool result. No network or secrets. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { sleepHours } from '../lib/nutrition/health';

type Sample = {
  source_key: string;
  metric: string;
  date: string;
  source: string;
  value: number | null;
  unit: string;
  observed_at: string | null;
  payload: Record<string, unknown>;
};
type Result = { content: { type: string; text?: string }[]; isError?: boolean };
function madrid(iso: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}
export function normalizeFreddy(results: Result[]): Sample[] {
  const samples: Sample[] = [];
  const sleep = new Map<
    string,
    { stage: string; start: string; end: string }[]
  >();
  function add(s: Omit<Sample, 'source_key'>) {
    samples.push({
      ...s,
      source_key: createHash('sha256').update(JSON.stringify(s)).digest('hex'),
    });
  }
  for (const result of results) {
    if (result.isError)
      throw new Error(
        'Freddy returned an error; do not import it as health data.',
      );
    let heading = '',
      current: Omit<Sample, 'source_key'> | null = null;
    for (const line of result.content
      .filter((c) => c.type === 'text')
      .flatMap((c) => (c.text ?? '').split('\n'))) {
      const date = /^(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?):$/.exec(line);
      if (date) {
        heading = date[1];
        current = null;
        continue;
      }
      const row = /^  ([a-z0-9_]+): (.*?) \(Apple Health · (.+)\)$/.exec(line);
      if (row) {
        if (!heading) throw new Error('Metric without date');
        const [, metric, body, device] = row;
        const time = / @ (\d{2}:\d{2}) UTC$/.exec(body);
        const observed = heading.includes('T')
          ? heading + ':00Z'
          : time
            ? heading + 'T' + time[1] + ':00Z'
            : null;
        const scalar = body.replace(/ @ .*$/, '');
        const number = /^(-?\d+(?:\.\d+)?)(?: (.+))?$/.exec(scalar);
        current = {
          metric,
          date: observed ? madrid(observed) : heading,
          source: 'Apple Health · ' + device,
          value: number ? Number(number[1]) : null,
          unit: number?.[2] ?? '',
          observed_at: observed,
          payload: { reported_date: heading, reported_value: scalar },
        };
        if (!metric.endsWith('_raw')) add(current);
        continue;
      }
      if (line.startsWith('    raw: ')) {
        if (!current) throw new Error('Raw payload without metric');
        const raw: unknown = JSON.parse(line.slice(9));
        if (current.metric === 'sleep_analysis_raw' && Array.isArray(raw)) {
          for (const s of raw) {
            if (
              typeof s.stage !== 'string' ||
              !Number.isFinite(Date.parse(s.start)) ||
              !Number.isFinite(Date.parse(s.end))
            )
              throw new Error('Invalid sleep interval');
          }
          // One source/night grouped by wake date. Union also removes duplicate partial exports.
          const end = raw
            .map((s) => s.end as string)
            .sort()
            .at(-1);
          if (end) {
            current.date = madrid(end);
            const key = current.source + '|' + current.date;
            sleep.set(key, [...(sleep.get(key) ?? []), ...raw]);
          }
        }
        add({ ...current, payload: { ...current.payload, raw } });
      }
    }
  }
  for (const [key, intervals] of sleep) {
    const split = key.lastIndexOf('|'),
      source = key.slice(0, split),
      date = key.slice(split + 1);
    const value = sleepHours(intervals);
    if (value != null && value <= 24)
      add({
        metric: 'sleep_hours',
        date,
        source,
        value: Math.round(value * 100) / 100,
        unit: 'h',
        observed_at: null,
        payload: {
          method: 'union of asleep intervals; Madrid wake date',
          intervals,
        },
      });
  }
  return [...new Map(samples.map((s) => [s.source_key, s])).values()];
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [, , input, output] = process.argv;
  if (!input || !output)
    throw new Error(
      'Usage: node --import tsx scripts/normalize-freddy.ts private/input.json private/samples.json',
    );
  writeFileSync(
    output,
    JSON.stringify(
      normalizeFreddy(JSON.parse(readFileSync(input, 'utf8'))),
      null,
      2,
    ),
  );
}
