import { addDays, type Measurement } from './model';

/** RFM, Woolcott & Bergman (2018). Adult estimate; lengths in centimetres. */
export function estimatedBodyFat(
  m: Pick<Measurement, 'height' | 'waist' | 'rfm_sex'>,
): number | null {
  if (
    m.height == null ||
    m.waist == null ||
    !['male', 'female'].includes(m.rfm_sex ?? '')
  )
    return null;
  if (
    !Number.isFinite(m.height) ||
    !Number.isFinite(m.waist) ||
    m.height < 100 ||
    m.height > 250 ||
    m.waist <= 0 ||
    m.waist > 300
  )
    return null;
  const value =
    64 - (20 * m.height) / m.waist + (m.rfm_sex === 'female' ? 12 : 0);
  return value > 0 && value < 100 ? Math.round(value * 10) / 10 : null;
}
export function reviewPeriod(date: string) {
  const weekday = new Date(date + 'T12:00:00Z').getUTCDay();
  const saturday = addDays(date, -((weekday + 1) % 7));
  return {
    start: addDays(saturday, -7),
    end: addDays(saturday, -1),
    target: addDays(saturday, 2),
  };
}
/** Union of asleep intervals, so overlapping exports/stages are counted only once. */
export function sleepHours(
  intervals: { stage: string; start: string; end: string }[],
) {
  const ranges = intervals
    .filter((s) =>
      ['core', 'deep', 'rem', 'asleep', 'unspecified'].includes(s.stage),
    )
    .map((s) => [Date.parse(s.start), Date.parse(s.end)])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a)
    .sort((a, b) => a[0] - b[0]);
  if (!ranges.length) return null;
  let total = 0,
    [start, end] = ranges[0];
  for (const [a, b] of ranges.slice(1)) {
    if (a <= end) end = Math.max(end, b);
    else {
      total += end - start;
      start = a;
      end = b;
    }
  }
  return (total + end - start) / 3600000;
}
export interface HealthSample {
  id: string;
  member_id: 'carlitos';
  source_key: string;
  metric: string;
  date: string;
  source: string;
  value: number | null;
  unit: string;
  observed_at: string | null;
  imported_at: string;
  payload: Record<string, unknown>;
}
export function latestHealthSamples(samples: HealthSample[]) {
  const latest = new Map<string, HealthSample>();
  for (const sample of [...samples].sort((a, b) =>
    a.imported_at.localeCompare(b.imported_at),
  )) {
    latest.set(
      [
        sample.member_id,
        sample.metric,
        sample.source,
        sample.date,
        sample.observed_at ?? '',
      ].join('|'),
      sample,
    );
  }
  return [...latest.values()];
}
export function sleepLabel(hours: number) {
  const minutes = Math.round(hours * 60);
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}
export interface HealthReport {
  kind: 'weekly' | 'manual';
  id: string;
  member_id: 'carlitos';
  period_start: string;
  period_end: string;
  target_week: string;
  status: 'ready' | 'insufficient' | 'error';
  summary: string;
  evidence: Record<string, unknown>;
  changes: { area: string; before: string; after: string; reason: string }[];
  base_plan_id: string | null;
  draft_plan_id: string | null;
  created_at: string;
}
export interface CoachingSettings {
  member_id: 'carlitos';
  goal: string;
  restrictions: string;
  updated_at: string;
}
export const HEALTH_LABELS: Record<string, string> = {
  sleep_hours: 'Sueño registrado (sin solapamientos)',
  body_mass: 'Peso',
  body_fat_pct: 'Grasa corporal',
  lean_body_mass: 'Masa libre de grasa',
  steps: 'Pasos',
  steps_total: 'Pasos (total combinado)',
  active_energy: 'Energía activa',
  active_energy_total: 'Energía activa (total combinado)',
  workout_duration: 'Duración del entrenamiento',
  workout_distance: 'Distancia del entrenamiento',
  workout_activity_type: 'Tipo de entrenamiento',
  workout_active_energy: 'Energía del entrenamiento',
  sleep_analysis_core_seconds: 'Sueño ligero',
  sleep_analysis_deep_seconds: 'Sueño profundo',
  sleep_analysis_rem_seconds: 'Sueño REM',
  sleep_analysis_awake_seconds: 'Tiempo despierto',
  sleep_analysis_in_bed_seconds: 'Tiempo en cama',
  resting_heart_rate_avg: 'Pulso en reposo',
  sleep_analysis_raw: 'Detalle del sueño',
  workout_raw: 'Detalle del entrenamiento',
};
