-- Existing installations only. Fresh installations use schema.sql.
begin;
alter table public.daily_records
  add column sleep_hours numeric(4,2) check(sleep_hours between 0 and 24),
  add column sleep_quality integer check(sleep_quality between 1 and 5);
commit;
