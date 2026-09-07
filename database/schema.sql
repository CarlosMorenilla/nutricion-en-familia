
-- Nutrición en Familia: schema version 1. Run in a NEW Supabase project.
begin;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;
create table public.profiles (
 id text primary key check (id in ('carlitos','papa','mama')),
 name text not null, role text not null check(role in ('admin','member')),
 user_id uuid unique references auth.users(id) on delete set null,
 check ((id='carlitos' and role='admin') or (id<>'carlitos' and role='member'))
);
create table private.allowed_emails(member_id text primary key references public.profiles(id),email text not null unique check(email=lower(email)));
create function private.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.profiles where user_id=auth.uid() and role='admin')
$$;
create function private.member_id() returns text language sql stable security definer set search_path='' as $$
 select id from public.profiles where user_id=auth.uid() and auth.uid() is not null
$$;
revoke all on function private.is_admin(),private.member_id() from public;
grant execute on function private.is_admin(),private.member_id() to authenticated;
create table public.plan_versions (
 id uuid primary key default gen_random_uuid(), week date not null check(extract(isodow from week)=1),
 version integer not null check(version>0),revision integer not null default 0,
 status text not null default 'draft' check(status in ('draft','published')),
 reviewed boolean not null default false, created_at timestamptz not null default now(),
 unique(week,version)
);
create table public.meal_bases (
 plan_id uuid references public.plan_versions(id) on delete cascade,
 day integer check(day between 0 and 6),slot text check(slot in ('comida','cena')),
 title text not null default '',instructions text not null default '',
 primary key(plan_id,day,slot)
);
create table public.member_plans (
 plan_id uuid references public.plan_versions(id) on delete cascade,member_id text references public.profiles(id),
 days jsonb not null check(jsonb_typeof(days)='array' and jsonb_array_length(days)=7),
 notes text not null default '',source text not null default '',primary key(plan_id,member_id)
);
create index member_plans_member on public.member_plans(member_id,plan_id);
create table public.daily_records (
 member_id text references public.profiles(id),date date not null,
 diet text check(diet in ('done','partial','missed')),training text check(training in ('done','partial','missed')),
 sleep_hours numeric(4,2) check(sleep_hours between 0 and 24),
 sleep_quality integer check(sleep_quality between 1 and 5),
 comment text not null default '' check(length(comment)<=2000),
 primary key(member_id,date),
 check(date <= (now() at time zone 'Europe/Madrid')::date)
);
create table public.measurements (
 member_id text references public.profiles(id),date date not null,
 weight numeric(5,2) check(weight between 0.1 and 400),
 waist numeric(5,2) check(waist between 0.1 and 300),hip numeric(5,2) check(hip between 0.1 and 300),
 chest numeric(5,2) check(chest between 0.1 and 300),arm numeric(5,2) check(arm between 0.1 and 300),thigh numeric(5,2) check(thigh between 0.1 and 300),
 primary key(member_id,date),
 check(num_nonnulls(weight,waist,hip,chest,arm,thigh)>0),
 check(date <= (now() at time zone 'Europe/Madrid')::date)
);
create table public.weekly_reviews (
 member_id text references public.profiles(id),week date not null check(extract(isodow from week)=1),
 hunger integer not null check(hunger between 1 and 5),energy integer not null check(energy between 1 and 5),sleep integer not null check(sleep between 1 and 5),
 comment text not null default '' check(length(comment)<=2000),primary key(member_id,week),
 check(week <= (now() at time zone 'Europe/Madrid')::date)
);
create function private.plan_visible(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (private.is_admin() or exists(select 1 from public.plan_versions v join public.member_plans m on m.plan_id=v.id where v.id=p_id and v.status='published' and m.member_id=private.member_id()))
$$;
create function private.plan_draft(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.is_admin() and exists(select 1 from public.plan_versions where id=p_id and status='draft')
$$;
revoke all on function private.plan_visible(uuid),private.plan_draft(uuid) from public;
grant execute on function private.plan_visible(uuid),private.plan_draft(uuid) to authenticated;
alter table public.profiles enable row level security;
alter table public.plan_versions enable row level security;
alter table public.meal_bases enable row level security;
alter table public.member_plans enable row level security;
alter table public.daily_records enable row level security;
alter table public.measurements enable row level security;
alter table public.weekly_reviews enable row level security;
revoke all on public.profiles,public.plan_versions,public.meal_bases,public.member_plans,public.daily_records,public.measurements,public.weekly_reviews from anon,authenticated;
grant select on public.profiles to authenticated;
grant select,insert,update,delete on public.plan_versions,public.meal_bases,public.member_plans,public.daily_records,public.measurements,public.weekly_reviews to authenticated;
create policy profile_read on public.profiles for select to authenticated using (user_id=(select auth.uid()) or (select private.is_admin()));
create policy version_read on public.plan_versions for select to authenticated using(private.plan_visible(id));
create policy version_insert on public.plan_versions for insert to authenticated with check((select private.is_admin()) and status='draft');
create policy version_update on public.plan_versions for update to authenticated using((select private.is_admin()) and status='draft') with check((select private.is_admin()));
create policy version_delete on public.plan_versions for delete to authenticated using((select private.is_admin()) and status='draft');
create policy base_read on public.meal_bases for select to authenticated using(private.plan_visible(plan_id));
create policy base_write on public.meal_bases for all to authenticated using(private.plan_draft(plan_id)) with check(private.plan_draft(plan_id));
create policy personal_read on public.member_plans for select to authenticated using((select private.is_admin()) or (member_id=(select private.member_id()) and private.plan_visible(plan_id)));
create policy personal_write on public.member_plans for all to authenticated using(private.plan_draft(plan_id)) with check(private.plan_draft(plan_id));
create policy daily_access on public.daily_records for all to authenticated using(member_id=(select private.member_id()) or (select private.is_admin())) with check(member_id=(select private.member_id()) or (select private.is_admin()));
create policy measure_access on public.measurements for all to authenticated using(member_id=(select private.member_id()) or (select private.is_admin())) with check(member_id=(select private.member_id()) or (select private.is_admin()));
create policy review_access on public.weekly_reviews for all to authenticated using(member_id=(select private.member_id()) or (select private.is_admin())) with check(member_id=(select private.member_id()) or (select private.is_admin()));

create function private.check_publication(p_id uuid) returns void language plpgsql security invoker set search_path='' as $$
declare m record; d jsonb; slot text;
begin
 if not exists(select 1 from public.member_plans where plan_id=p_id) then raise exception 'Añade al menos una persona al plan.'; end if;
 if (select count(*) from public.meal_bases where plan_id=p_id and length(trim(title))>0)<>14 then raise exception 'Completa las 14 comidas y cenas familiares.'; end if;
 for m in select * from public.member_plans where plan_id=p_id loop
  for d in select value from jsonb_array_elements(m.days) loop
   foreach slot in array array['desayuno','comida','merienda','cena'] loop
    if jsonb_typeof(d->'meals'->slot->'portion') is distinct from 'string' or length(trim(d->'meals'->slot->>'portion'))=0 then raise exception 'Faltan raciones para %.',m.member_id; end if;
   end loop;
   if jsonb_typeof(d->'workout'->'title') is distinct from 'string' or length(trim(d->'workout'->>'title'))=0 then raise exception 'Indica entrenamiento o descanso para %.',m.member_id; end if;
  end loop;
 end loop;
end $$;
create function private.guard_version() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op<>'INSERT' and old.status='published' then raise exception 'Un plan publicado es inmutable. Crea otra versión.'; end if;
 if tg_op='DELETE' then return old; end if;
 if new.status='published' then
  if tg_op='INSERT' then raise exception 'Guarda primero el borrador.'; end if;
  if not new.reviewed then raise exception 'Confirma la revisión de los menús.'; end if;
  perform private.check_publication(new.id);
 end if;
 return new;
end $$;
create trigger version_guard before insert or update or delete on public.plan_versions for each row execute function private.guard_version();
create function private.guard_plan_child() returns trigger language plpgsql security invoker set search_path='' as $$
declare parent uuid;
begin
 if tg_op<>'INSERT' then
  if exists(select 1 from public.plan_versions where id=old.plan_id and status='published') then raise exception 'El historial publicado no se puede modificar.'; end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 parent:=new.plan_id;
 if exists(select 1 from public.plan_versions where id=parent and status='published') then raise exception 'El historial publicado no se puede modificar.'; end if;
 return new;
end $$;
create trigger bases_guard before insert or update or delete on public.meal_bases for each row execute function private.guard_plan_child();
create trigger personal_guard before insert or update or delete on public.member_plans for each row execute function private.guard_plan_child();
revoke all on function private.check_publication(uuid),private.guard_version(),private.guard_plan_child() from public;
grant execute on function private.check_publication(uuid) to authenticated;

create function public.save_family_plan(payload jsonb,publish boolean default false) returns uuid language plpgsql security invoker set search_path='' as $$
declare p_id uuid:=(payload->>'id')::uuid; p_week date:=(payload->>'week')::date; current_version public.plan_versions; s jsonb; m jsonb;
begin
 if not private.is_admin() then raise exception 'Solo el administrador puede editar planes.'; end if;
 if jsonb_typeof(payload->'members') is distinct from 'array' or jsonb_typeof(payload->'shared') is distinct from 'array' then raise exception 'Plan no válido.'; end if;
 perform pg_advisory_xact_lock(hashtext(p_week::text));
 select * into current_version from public.plan_versions where id=p_id for update;
 if found then
  if current_version.status<>'draft' then raise exception 'Crea una nueva versión del plan publicado.'; end if;
  if current_version.revision<>(payload->>'revision')::integer then raise exception 'Otra sesión ha cambiado este borrador. Recarga antes de editar.'; end if;
  if current_version.week<>p_week then raise exception 'Duplica el plan para cambiar de semana.'; end if;
  update public.plan_versions set revision=revision+1,reviewed=coalesce((payload->>'reviewed')::boolean,false) where id=p_id;
 else
  insert into public.plan_versions(id,week,version,revision,reviewed) select p_id,p_week,coalesce(max(version),0)+1,1,coalesce((payload->>'reviewed')::boolean,false) from public.plan_versions where week=p_week;
 end if;
 delete from public.meal_bases where plan_id=p_id;
 delete from public.member_plans where plan_id=p_id;
 for s in select value from jsonb_array_elements(payload->'shared') loop
  insert into public.meal_bases(plan_id,day,slot,title,instructions) values(p_id,(s->>'day')::integer,s->>'slot',coalesce(s->>'title',''),coalesce(s->>'instructions',''));
 end loop;
 for m in select value from jsonb_array_elements(payload->'members') loop
  insert into public.member_plans(plan_id,member_id,days,notes,source) values(p_id,m->>'member_id',m->'days',coalesce(m->>'notes',''),coalesce(m->>'source',''));
 end loop;
 if publish then update public.plan_versions set status='published' where id=p_id; end if;
 return p_id;
end $$;
revoke all on function public.save_family_plan(jsonb,boolean) from public,anon;
grant execute on function public.save_family_plan(jsonb,boolean) to authenticated;

-- Only a verified Google identity with an explicitly allowed email can bind a profile.
create function private.bind_google_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.email_confirmed_at is not null and new.raw_app_meta_data->>'provider'='google' then
  update public.profiles p set user_id=new.id from private.allowed_emails a
  where p.id=a.member_id and a.email=lower(new.email) and (p.user_id is null or p.user_id=new.id);
 end if;
 return new;
end $$;
revoke all on function private.bind_google_profile() from public;
create trigger bind_nutrition_profile after insert or update of email_confirmed_at,email on auth.users for each row execute function private.bind_google_profile();
insert into public.profiles(id,name,role) values('carlitos','Carlitos','admin'),('papa','Papá','member'),('mama','Mamá','member');
commit;

