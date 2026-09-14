import { createClient } from '@supabase/supabase-js';
import type {
  DataSet,
  Daily,
  Measurement,
  Review,
  Plan,
  Person,
  Profile,
} from './model';
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const supabase =
  url && key
    ? createClient(url, key, {
        auth: {
          flowType: 'pkce',
          detectSessionInUrl: true,
          persistSession: true,
          autoRefreshToken: true,
        },
      })
    : null;
export async function signIn() {
  if (!supabase) throw new Error('El acceso está pendiente de configuración.');
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin + '/',
      queryParams: { prompt: 'select_account' },
    },
  });
  if (error) throw error;
}
async function rows(table: string) {
  if (!supabase) throw new Error('No hay conexión configurada.');
  const out: Record<string, unknown>[] = [];
  const keys = [
    'profiles',
    'plan_versions',
    'health_samples',
    'health_reports',
  ].includes(table)
    ? ['id']
    : table === 'coaching_settings'
      ? ['member_id']
      : table === 'member_plans'
        ? ['plan_id', 'member_id']
        : table === 'meal_bases'
          ? ['plan_id', 'day', 'slot']
          : table === 'weekly_reviews'
            ? ['member_id', 'week']
            : ['member_id', 'date'];
  for (let start = 0; ; start += 500) {
    let query = supabase.from(table).select('*');
    for (const key of keys) query = query.order(key);
    const { data, error } = await query.range(start, start + 499);
    if (error) throw error;
    out.push(...data);
    if (data.length < 500) return out;
  }
}
export async function fetchData(): Promise<DataSet> {
  const [
    profiles,
    versions,
    bases,
    personal,
    daily,
    measurements,
    reviews,
    healthSamples,
    healthReports,
    coachingSettings,
  ] = await Promise.all(
    [
      'profiles',
      'plan_versions',
      'meal_bases',
      'member_plans',
      'daily_records',
      'measurements',
      'weekly_reviews',
      'health_samples',
      'health_reports',
      'coaching_settings',
    ].map(rows),
  );
  return {
    healthSamples: healthSamples as unknown as DataSet['healthSamples'],
    healthReports: healthReports as unknown as DataSet['healthReports'],
    coachingSettings:
      coachingSettings as unknown as DataSet['coachingSettings'],
    profiles: profiles as unknown as Profile[],
    plans: versions.map((v) => ({
      ...v,
      shared: bases.filter((b) => b.plan_id === v.id),
      members: personal.filter((m) => m.plan_id === v.id),
    })) as unknown as Plan[],
    daily: daily as unknown as Daily[],
    measurements: measurements as unknown as Measurement[],
    reviews: reviews as unknown as Review[],
  };
}
export async function saveRecord(
  table: 'daily_records' | 'measurements' | 'weekly_reviews',
  value: Daily | Measurement | Review,
) {
  if (!supabase) throw new Error('Sin conexión');
  const { error } = await supabase
    .from(table)
    .upsert(value as unknown as Record<string, unknown>, {
      onConflict:
        table === 'weekly_reviews' ? 'member_id,week' : 'member_id,date',
    });
  if (error) throw error;
}
export async function removeMeasurement(member_id: Person, date: string) {
  if (!supabase) throw new Error('Sin conexión');
  const { error } = await supabase
    .from('measurements')
    .delete()
    .eq('member_id', member_id)
    .eq('date', date);
  if (error) throw error;
}
export async function savePlan(plan: Plan, publish = false) {
  if (!supabase) throw new Error('Sin conexión');
  const { data, error } = await supabase.rpc('save_family_plan', {
    payload: plan,
    publish,
  });
  if (error) throw error;
  return data as string;
}
