begin;
alter table public.health_reports add column kind text not null default 'weekly' check(kind in ('weekly','manual'));
alter table public.health_reports drop constraint health_reports_period_start_check;
do $$ declare c record; begin
 for c in select conname from pg_constraint where conrelid='public.health_reports'::regclass and contype='c' and pg_get_constraintdef(oid) like '%target_week%' loop
 execute format('alter table public.health_reports drop constraint %I',c.conname);
 end loop;
end $$;
alter table public.health_reports add constraint report_calendar check(
(kind='weekly' and extract(isodow from period_start)=6 and target_week=period_end+3) or
(kind='manual' and extract(isodow from period_start)=1 and target_week=period_end+1));
create or replace function private.record_health_review(payload jsonb) returns uuid
 language plpgsql security invoker set search_path='' as $$
declare start_date date:=(payload->>'period_start')::date; report_id uuid; base_id uuid;
 draft_id uuid; next_week date:=start_date+case when payload->>'kind'='manual' then 7 else 9 end; proposal jsonb:=payload->'proposal';
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
 insert into public.health_reports(kind,member_id,period_start,period_end,target_week,status,summary,evidence,changes,base_plan_id,draft_plan_id)
 values(coalesce(payload->>'kind','weekly'),'carlitos',start_date,start_date+6,next_week,payload->>'status',payload->>'summary',
 coalesce(payload->'evidence','{}'::jsonb),coalesce(payload->'changes','[]'::jsonb),base_id,draft_id) returning id into report_id;
 return report_id;
end $$;

commit;
