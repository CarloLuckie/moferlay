-- SUNDAY CLUB — Schema de Supabase (Postgres). Ejecutar en SQL Editor.
-- 1) Habilita Supabase Auth > Sign In > Anonymous Sign-Ins.
-- 2) La key SERVICE ROLE SOLO debe ir en GitHub Secrets, JAMAS en la web.

create extension if not exists pgcrypto;
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 3 and 48),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  nickname text not null check (char_length(trim(nickname)) between 2 and 22),
  joined_at timestamptz not null default now(),
  primary key (group_id,user_id)
);
create unique index if not exists group_members_nickname_ci
  on public.group_members(group_id,lower(trim(nickname)));

create table if not exists public.games (
  season integer not null check (season between 2020 and 2100),
  week integer not null check (week between 1 and 18),
  event_id text not null,
  kickoff_at timestamptz not null,
  away_team text not null,
  home_team text not null,
  away_name text not null,
  home_name text not null,
  away_logo text,
  home_logo text,
  status text not null default 'pre' check (status in ('pre','in','post')),
  winner text,
  away_score integer,
  home_score integer,
  updated_at timestamptz not null default now(),
  primary key (season,week,event_id),
  constraint valid_winner check (winner is null or winner in (home_team,away_team))
);

create table if not exists public.picks (
  group_id uuid not null,
  user_id uuid not null,
  season integer not null,
  week integer not null,
  event_id text not null,
  pick_team text not null,
  confidence integer not null check (confidence between 1 and 16),
  updated_at timestamptz not null default now(),
  primary key (group_id,user_id,season,week,event_id),
  unique (group_id,user_id,season,week,confidence),
  foreign key (group_id,user_id) references public.group_members(group_id,user_id) on delete cascade,
  foreign key (season,week,event_id) references public.games(season,week,event_id) on delete cascade
);
create index if not exists idx_picks_group_season on public.picks(group_id,season,week);

alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.games enable row level security;
alter table public.picks enable row level security;

-- Consulta de pertenencia: SECURITY DEFINER impide recursion entre RLS.
create or replace function public.is_group_member(p_group uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists (select 1 from public.group_members where group_id=p_group and user_id=(select auth.uid())); $$;
revoke all on function public.is_group_member(uuid) from public;
grant execute on function public.is_group_member(uuid) to authenticated;

-- Los UUID de grupos son enlaces no enumerables; solo los miembros pueden leerlos.
drop policy if exists group_read on public.groups;
create policy group_read on public.groups for select to authenticated using (public.is_group_member(id));
drop policy if exists member_read on public.group_members;
create policy member_read on public.group_members for select to authenticated using (public.is_group_member(group_id));
drop policy if exists game_read on public.games;
create policy game_read on public.games for select to authenticated using (true);
drop policy if exists pick_read on public.picks;
create policy pick_read on public.picks for select to authenticated using (public.is_group_member(group_id));

-- No hay políticas de escritura directa desde la web. Las mutaciones se hacen
-- mediante RPC con verificaciones del servidor y transacciones atomicas.
revoke all on public.groups,public.group_members,public.games,public.picks from anon,authenticated;
grant select on public.groups,public.group_members,public.games,public.picks to authenticated;

create or replace function public.create_group(p_name text,p_nickname text)
returns uuid language plpgsql security definer set search_path=public
as $$
declare v_id uuid; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Debes iniciar sesion.'; end if;
  p_name := trim(p_name);p_nickname:=trim(p_nickname);
  if char_length(p_name) not between 3 and 48 or char_length(p_nickname) not between 2 and 22
    then raise exception 'Verifica el nombre de la liga y el apodo.';end if;
  insert into public.groups (name,owner_id) values(p_name,v_uid) returning id into v_id;
  insert into public.group_members (group_id,user_id,nickname) values(v_id,v_uid,p_nickname);
  return v_id;
end; $$;

create or replace function public.join_group(p_group_id uuid,p_nickname text)
returns text language plpgsql security definer set search_path=public
as $$
declare v_uid uuid := auth.uid();v_name text;
begin
  if v_uid is null then raise exception 'Debes iniciar sesion.'; end if;
  p_nickname:=trim(p_nickname);
  if char_length(p_nickname) not between 2 and 22 then raise exception 'El apodo debe tener entre 2 y 22 caracteres.';end if;
  select name into v_name from public.groups where id=p_group_id;
  if v_name is null then raise exception 'El enlace de la liga no existe.';end if;
  insert into public.group_members (group_id,user_id,nickname) values(p_group_id,v_uid,p_nickname)
  on conflict (group_id,user_id) do update set nickname=excluded.nickname;
  return v_name;
end; $$;

-- Actualizacion integral: conserva picks empezados y deja editar solo los
-- partidos no iniciados. Enforce en el servidor, incluso si alteran el JS.
create or replace function public.submit_week_picks(
  p_group_id uuid,p_season integer,p_week integer,p_picks jsonb
) returns void language plpgsql security definer set search_path=public
as $$
declare
  v_uid uuid := auth.uid();v_count integer; v_pick jsonb;
  v_event text;v_team text;v_conf integer;
begin
  if v_uid is null or not public.is_group_member(p_group_id) then raise exception 'No perteneces a esta liga.'; end if;
  if p_picks is null or jsonb_typeof(p_picks)<>'array' then raise exception 'Formato de picks invalido.';end if;
  select count(*) into v_count from public.games where season=p_season and week=p_week;
  if v_count=0 then raise exception 'Aun no hay calendario cargado para esta semana.';end if;
  if jsonb_array_length(p_picks)>v_count then raise exception 'Demasiados picks.';end if;
  -- Protege frente a dobles envios simultaneos de la misma cuenta.
  perform pg_advisory_xact_lock(hashtext(v_uid::text),hashtext(p_group_id::text||':'||p_season||':'||p_week));
  for v_pick in select value from jsonb_array_elements(p_picks) loop
    v_event:=v_pick->>'event_id';v_team:=v_pick->>'pick_team';v_conf:=(v_pick->>'confidence')::integer;
    if v_event is null or v_team is null or v_conf is null or v_conf not between 1 and v_count
      then raise exception 'Pick o confianza invalida.';end if;
    if not exists(select 1 from public.games g where g.season=p_season and g.week=p_week and g.event_id=v_event
      and g.kickoff_at>now() and g.status='pre' and v_team in (g.home_team,g.away_team))
      then raise exception 'Partido iniciado, inexistente o equipo invalido.';end if;
  end loop;
  if exists(select 1 from jsonb_to_recordset(p_picks) as t(event_id text,pick_team text,confidence integer)
    group by event_id having count(*)>1) then raise exception 'Partido repetido.';end if;
  if exists(select 1 from jsonb_to_recordset(p_picks) as t(event_id text,pick_team text,confidence integer)
    group by confidence having count(*)>1) then raise exception 'Confianza repetida.';end if;

  -- Elimina solamente picks anteriores de encuentros todavia editables.
  delete from public.picks p using public.games g
  where p.group_id=p_group_id and p.user_id=v_uid and p.season=p_season and p.week=p_week
    and g.season=p.season and g.week=p.week and g.event_id=p.event_id
    and g.kickoff_at>now() and g.status='pre';

  insert into public.picks(group_id,user_id,season,week,event_id,pick_team,confidence)
    select p_group_id,v_uid,p_season,p_week,x.event_id,x.pick_team,x.confidence
    from jsonb_to_recordset(p_picks) as x(event_id text,pick_team text,confidence integer);
end; $$;
revoke all on function public.create_group(text,text) from public;
revoke all on function public.join_group(uuid,text) from public;
revoke all on function public.submit_week_picks(uuid,integer,integer,jsonb) from public;
grant execute on function public.create_group(text,text) to authenticated;
grant execute on function public.join_group(uuid,text) to authenticated;
grant execute on function public.submit_week_picks(uuid,integer,integer,jsonb) to authenticated;

-- Notificaciones en tiempo real (picks y participantes). Para games también,
-- el cliente hará polling cada minuto aunque realtime no esté disponible.
do $$ begin
  alter publication supabase_realtime add table public.picks;
exception when duplicate_object then null;end $$;
do $$ begin
  alter publication supabase_realtime add table public.group_members;
exception when duplicate_object then null;end $$;
do $$ begin
  alter publication supabase_realtime add table public.games;
exception when duplicate_object then null;end $$;
