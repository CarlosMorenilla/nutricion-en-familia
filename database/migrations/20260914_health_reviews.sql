begin;
alter table public.measurements
 add column body_fat numeric(5,2) check(body_fat > 0 and body_fat < 100),
 add column height numeric(5,2) check(height between 100 and 250),
 add column rfm_sex text check(rfm_sex in ('male','female')),
 add column body_fat_source text not null default '' check(length(body_fat_source)<=200);
-- Replace only the old at-least-one-measure constraint, retaining date/range guards.
do $$ declare c record; begin
 for c in select conname from pg_constraint where conrelid='public.measurements'::regclass
 and pg_get_constraintdef(oid) like '%num_nonnulls%' loop
 execute format('alter table public.measurements drop constraint %I',c.conname);
 end loop;
end $$;
alter table public.measurements add constraint measurement_has_value
 check(num_nonnulls(weight,waist,hip,chest,arm,thigh,body_fat)>0);

create table public.health_samples (
 id uuid primary key default gen_random_uuid(),
 member_id text not null references public.profiles(id) check(member_id='carlitos'),
 source_key text not null unique check(length(source_key) between 1 and 300),
 metric text not null check(length(metric) between 1 and 100),
 date date not null check(date <= (now() at time zone 'Europe/Madrid')::date),
 source text not null check(length(source) between 1 and 200),
 value numeric, unit text not null default '',
 observed_at timestamptz,
 payload jsonb not null default '{}'::jsonb check(pg_column_size(payload)<1000000),
 imported_at timestamptz not null default now()
);
create index health_samples_member_date on public.health_samples(member_id,date);
create table public.coaching_settings (
 member_id text primary key references public.profiles(id) check(member_id='carlitos'),
 goal text not null default '' check(length(goal)<=2000),
 restrictions text not null default '' check(length(restrictions)<=4000),
 updated_at timestamptz not null default now()
);
create table public.health_reports (
 id uuid primary key default gen_random_uuid(),
 member_id text not null references public.profiles(id) check(member_id='carlitos'),
 period_start date not null check(extract(isodow from period_start)=6),
 period_end date not null check(period_end=period_start+6),
 target_week date not null check(target_week=period_end+3),
 status text not null check(status in ('ready','insufficient','error')),
 summary text not null check(length(summary) between 1 and 20000),
 evidence jsonb not null default '{}'::jsonb,
 changes jsonb not null default '[]'::jsonb check(jsonb_typeof(changes)='array'),
 base_plan_id uuid references public.plan_versions(id) on delete set null,
 draft_plan_id uuid references public.plan_versions(id) on delete set null,
 created_at timestamptz not null default now(),
 unique(member_id,period_start),
 check(period_end < (now() at time zone 'Europe/Madrid')::date)
);
alter table public.health_samples enable row level security;
alter table public.coaching_settings enable row level security;
alter table public.health_reports enable row level security;
revoke all on public.health_samples,public.coaching_settings,public.health_reports from public,anon,authenticated;
grant select on public.health_samples,public.health_reports to authenticated;
grant select,insert,update on public.coaching_settings to authenticated;
create policy health_sample_read on public.health_samples for select to authenticated
 using(member_id=(select private.member_id()) or (select private.is_admin()));
create policy health_report_read on public.health_reports for select to authenticated using((select private.is_admin()));
create policy coaching_read on public.coaching_settings for select to authenticated using((select private.is_admin()));
create policy coaching_insert on public.coaching_settings for insert to authenticated with check((select private.is_admin()));
create policy coaching_update on public.coaching_settings for update to authenticated using((select private.is_admin())) with check((select private.is_admin()));

-- Backend-only ingestion. Browser roles cannot execute these routines or write imports.
-- Append-only source snapshots never update the manually editable daily/measurement tables.
create function private.ingest_health_samples(samples jsonb) returns integer
 language plpgsql security invoker set search_path='' as $$
declare s jsonb; inserted integer:=0; n integer;
begin
 if jsonb_typeof(samples) is distinct from 'array' or jsonb_array_length(samples)>5000 then raise exception 'Lote no válido'; end if;
 for s in select value from jsonb_array_elements(samples) loop
 insert into public.health_samples(member_id,source_key,metric,date,source,value,unit,observed_at,payload)
 values('carlitos',s->>'source_key',s->>'metric',(s->>'date')::date,s->>'source',
 (s->>'value')::numeric,coalesce(s->>'unit',''),(s->>'observed_at')::timestamptz,coalesce(s->'payload','{}'::jsonb))
 on conflict(source_key) do nothing;
 get diagnostics n=row_count; inserted:=inserted+n;
 end loop;
 return inserted;
end $$;
revoke all on function private.ingest_health_samples(jsonb) from public,anon,authenticated;

-- One immutable report/draft per period, transactionally. The optional proposal can
-- replace Carlitos' personal plan only. Shared meals and other members are copied.
create function private.record_health_review(payload jsonb) returns uuid
 language plpgsql security invoker set search_path='' as $$
declare start_date date:=(payload->>'period_start')::date; report_id uuid; base_id uuid;
 draft_id uuid; next_week date:=start_date+9; proposal jsonb:=payload->'proposal';
begin
 perform pg_advisory_xact_lock(hashtext('health:'||start_date::text));
 select id into report_id from public.health_reports where member_id='carlitos' and period_start=start_date;
 if found then return report_id; end if;
 if proposal is not null and proposal<>'null'::jsonb then
  if payload->>'status'<>'ready' or jsonb_typeof(proposal->'days') is distinct from 'array'
   or jsonb_array_length(proposal->'days')<>7 then raise exception 'Propuesta no válida'; end if;
  if not exists(select 1 from public.coaching_settings where member_id='carlitos' and length(trim(goal))>0)
   then raise exception 'Falta el objetivo confirmado'; end if;
 end if;
 select v.id into base_id from public.plan_versions v join public.member_plans m on m.plan_id=v.id
 where m.member_id='carlitos' and v.status='published' and v.week<=next_week
 order by v.week desc,v.version desc limit 1;
 if base_id is not null and payload->>'status'<>'error' then
  perform pg_advisory_xact_lock(hashtext(next_week::text));
  insert into public.plan_versions(week,version,revision)
  select next_week,coalesce(max(version),0)+1,1 from public.plan_versions where week=next_week returning id into draft_id;
  insert into public.meal_bases select draft_id,day,slot,title,instructions from public.meal_bases where plan_id=base_id;
  insert into public.member_plans(plan_id,member_id,days,notes,source)
  select draft_id,member_id,
   case when member_id='carlitos' and proposal is not null and proposal<>'null'::jsonb then proposal->'days' else days end,
   case when member_id='carlitos' and proposal is not null and proposal<>'null'::jsonb then coalesce(proposal->>'notes',notes) else notes end,
   case when member_id='carlitos' then 'Revisión semanal; pendiente de aprobación. Base: '||base_id::text else source end
  from public.member_plans where plan_id=base_id;
 end if;
 insert into public.health_reports(member_id,period_start,period_end,target_week,status,summary,evidence,changes,base_plan_id,draft_plan_id)
 values('carlitos',start_date,start_date+6,next_week,payload->>'status',payload->>'summary',
 coalesce(payload->'evidence','{}'::jsonb),coalesce(payload->'changes','[]'::jsonb),base_id,draft_id) returning id into report_id;
 return report_id;
end $$;
revoke all on function private.record_health_review(jsonb) from public,anon,authenticated;
commit;
