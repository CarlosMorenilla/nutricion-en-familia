export const PEOPLE = ['carlitos', 'papa', 'mama'] as const;
export type Person = (typeof PEOPLE)[number];
export const NAMES: Record<Person, string> = {
  carlitos: 'Carlitos',
  papa: 'Papá',
  mama: 'Mamá',
};
export const SLOTS = ['desayuno', 'comida', 'merienda', 'cena'] as const;
export type Slot = (typeof SLOTS)[number];
export const SLOT_LABELS: Record<Slot, string> = {
  desayuno: 'Desayuno',
  comida: 'Comida',
  merienda: 'Merienda',
  cena: 'Cena',
};
export const DAYS = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo',
];
export type Status = 'done' | 'partial' | 'missed' | null;
export interface Profile {
  id: Person;
  name: string;
  role: 'admin' | 'member';
  user_id: string | null;
}
export interface Meal {
  title: string;
  portion: string;
  substitution: string;
}
export interface Workout {
  title: string;
  details: string;
  intensity: string;
  rest: string;
  exercises: string;
}
export interface DayPlan {
  meals: Record<Slot, Meal>;
  workout: Workout;
  notes: string;
}
export interface PersonalPlan {
  member_id: Person;
  days: DayPlan[];
  notes: string;
  source: string;
}
export interface SharedMeal {
  day: number;
  slot: 'comida' | 'cena';
  title: string;
  instructions: string;
}
export interface Plan {
  id: string;
  week: string;
  version: number;
  revision: number;
  status: 'draft' | 'published';
  reviewed: boolean;
  shared: SharedMeal[];
  members: PersonalPlan[];
  created_at?: string;
}
export interface Daily {
  member_id: Person;
  date: string;
  diet: Status;
  training: Status;
  sleep_hours?: number | null;
  sleep_quality?: number | null;
  comment: string;
}
export const MEASURES = [
  'weight',
  'waist',
  'hip',
  'chest',
  'arm',
  'thigh',
] as const;
export type Measure = (typeof MEASURES)[number];
export const MEASURE_LABELS: Record<Measure, string> = {
  weight: 'Peso',
  waist: 'Cintura',
  hip: 'Cadera',
  chest: 'Pecho',
  arm: 'Brazo',
  thigh: 'Muslo',
};
export interface Measurement {
  member_id: Person;
  date: string;
  weight: number | null;
  waist: number | null;
  hip: number | null;
  chest: number | null;
  arm: number | null;
  thigh: number | null;
}
export interface Review {
  member_id: Person;
  week: string;
  hunger: number;
  energy: number;
  sleep: number;
  comment: string;
}
export interface DataSet {
  profiles: Profile[];
  plans: Plan[];
  daily: Daily[];
  measurements: Measurement[];
  reviews: Review[];
}
export function today() {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  return ['year', 'month', 'day']
    .map((t) => p.find((a) => a.type === t)!.value)
    .join('-');
}
export function addDays(date: string, n: number) {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function monday(date: string) {
  const d = new Date(date + 'T12:00:00Z');
  return addDays(date, -((d.getUTCDay() + 6) % 7));
}
export function dayIndex(date: string) {
  return (new Date(date + 'T12:00:00Z').getUTCDay() + 6) % 7;
}
export function prettyDate(date: string, short = false) {
  return new Intl.DateTimeFormat('es-ES', {
    day: 'numeric',
    month: short ? 'short' : 'long',
    timeZone: 'UTC',
  }).format(new Date(date + 'T12:00:00Z'));
}
export function validDate(date: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    !Number.isNaN(Date.parse(date + 'T12:00:00Z')) &&
    new Date(date + 'T12:00:00Z').toISOString().slice(0, 10) === date
  );
}
export function decimal(value: string, min = 0.1, max = 400): number | null {
  if (!value.trim()) return null;
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized))
    throw new Error('Introduce un número válido, con hasta dos decimales.');
  const n = Number(normalized);
  if (n < min || n > max)
    throw new Error('El valor debe estar entre ' + min + ' y ' + max + '.');
  return n;
}
export function blankDay(): DayPlan {
  return {
    meals: Object.fromEntries(
      SLOTS.map((s) => [s, { title: '', portion: '', substitution: '' }]),
    ) as Record<Slot, Meal>,
    workout: { title: '', details: '', intensity: '', rest: '', exercises: '' },
    notes: '',
  };
}
export function blankPlan(week: string): Plan {
  return {
    id: crypto.randomUUID(),
    week,
    version: 1,
    revision: 0,
    status: 'draft',
    reviewed: false,
    shared: DAYS.flatMap((_, day) =>
      ['comida', 'cena'].map((slot) => ({
        day,
        slot: slot as 'comida' | 'cena',
        title: '',
        instructions: '',
      })),
    ),
    members: [],
  };
}
export function publishedPlan(plans: Plan[], date: string, person: Person) {
  return plans
    .filter(
      (p) =>
        p.week === monday(date) &&
        p.status === 'published' &&
        p.members.some((m) => m.member_id === person),
    )
    .sort((a, b) => b.version - a.version)[0];
}
export function adherence(records: Daily[], field: 'diet' | 'training') {
  const values = records.map((r) => r[field]).filter((v) => v !== null);
  return {
    count: values.length,
    done: values.filter((v) => v === 'done').length,
    partial: values.filter((v) => v === 'partial').length,
    percent: values.length
      ? Math.round(
          (100 * values.filter((v) => v === 'done').length) / values.length,
        )
      : null,
  };
}
export function weeklyWeights(records: Measurement[]) {
  const groups = new Map<string, number[]>();
  for (const r of records) {
    if (r.weight !== null) {
      const week = monday(r.date);
      groups.set(week, [...(groups.get(week) || []), r.weight]);
    }
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, values]) => ({
      week,
      count: values.length,
      average:
        Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) /
        100,
    }));
}
export function validatePlan(p: Plan) {
  if (!validDate(p.week) || monday(p.week) !== p.week)
    throw new Error('La semana debe comenzar un lunes.');
  if (!p.reviewed)
    throw new Error(
      'Revisa las diferencias de los menús y confirma la revisión.',
    );
  if (!p.members.length) throw new Error('Añade al menos una persona al plan.');
  for (let day = 0; day < 7; day++) {
    for (const slot of ['comida', 'cena'])
      if (!p.shared.find((s) => s.day === day && s.slot === slot)?.title.trim())
        throw new Error('Falta el plato familiar del ' + DAYS[day] + '.');
  }
  for (const m of p.members) {
    if (m.days.length !== 7) throw new Error('El plan debe tener siete días.');
    for (let d = 0; d < 7; d++) {
      for (const s of SLOTS)
        if (!m.days[d].meals[s].portion.trim())
          throw new Error(
            NAMES[m.member_id] +
              ': faltan cantidades o una indicación en ' +
              SLOT_LABELS[s] +
              ' del ' +
              DAYS[d] +
              '.',
          );
      if (!m.days[d].workout.title.trim())
        throw new Error(
          NAMES[m.member_id] +
            ': indica entrenamiento o descanso el ' +
            DAYS[d] +
            '.',
        );
    }
  }
}
