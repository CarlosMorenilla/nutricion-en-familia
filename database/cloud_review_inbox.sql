-- Backend-only handoff from ChatGPT Work to local Codex. No browser access.
begin;
create table if not exists private.cloud_health_reviews (
  period_start date primary key check(extract(isodow from period_start)=6),
  period_end date not null check(period_end=period_start+6),
  member_id text not null default 'carlitos' check(member_id='carlitos'),
  status text not null check(status in ('ready','insufficient','error')),
  summary text not null check(length(summary) between 1 and 20000),
  evidence jsonb not null check(jsonb_typeof(evidence)='object'),
  raw_responses jsonb not null check(jsonb_typeof(raw_responses)='array' and pg_column_size(raw_responses)<2000000),
  created_at timestamptz not null default now(),
  check(period_end < (now() at time zone 'Europe/Madrid')::date)
);
alter table private.cloud_health_reviews enable row level security;
revoke all on private.cloud_health_reviews from public, anon, authenticated;
-- A row is pending while no health_reports row exists for its period.
-- Insert with ON CONFLICT DO NOTHING: retries cannot replace a saved review.
commit;
