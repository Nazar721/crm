begin;
-- Run as the project administrator. No client key receives administrative access.
create table if not exists public.crm_owners (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create table if not exists public.crm_state (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 0,
  last_request uuid,
  settings jsonb not null default '{"usdRate":41,"eurRate":44,"usdtRate":41,"displayCurrency":"UAH"}',
  meta jsonb not null default '{"lastSavedAt":"","lastManualBackupAt":"","backupSnoozedUntil":""}'
);
create table if not exists public.crm_records (
  owner_id uuid not null references public.crm_state(owner_id) on delete cascade,
  collection text not null check (collection in ('projectsActive','projectsCompleted','clients','specialists','partners','transactions','personalDebts','savings')),
  id text not null,
  position integer not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and payload->>'id' = id),
  primary key(owner_id,collection,id)
);
alter table public.crm_owners enable row level security;
alter table public.crm_state enable row level security;
alter table public.crm_records enable row level security;
revoke all on public.crm_owners,public.crm_state,public.crm_records from anon,authenticated;
grant select on public.crm_owners,public.crm_state,public.crm_records to authenticated;
drop policy if exists own_membership on public.crm_owners;
create policy own_membership on public.crm_owners for select to authenticated using (user_id=(select auth.uid()));
drop policy if exists own_state on public.crm_state;
create policy own_state on public.crm_state for select to authenticated using (owner_id=(select auth.uid()) and exists(select 1 from public.crm_owners where user_id=(select auth.uid())));
drop policy if exists own_records on public.crm_records;
create policy own_records on public.crm_records for select to authenticated using (owner_id=(select auth.uid()) and exists(select 1 from public.crm_owners where user_id=(select auth.uid())));

create or replace function public.crm_read() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid:=auth.uid(); result jsonb; s public.crm_state; k text;
begin
  if u is null or not exists(select 1 from public.crm_owners where user_id=u) then raise exception 'CRM_ACCESS_DENIED'; end if;
  insert into public.crm_state(owner_id) values(u) on conflict do nothing;
  select * into s from public.crm_state where owner_id=u for share;
  result:=jsonb_build_object('financeSettings',s.settings,'meta',s.meta);
  foreach k in array array['projectsActive','projectsCompleted','clients','specialists','partners','transactions','personalDebts','savings'] loop
    result:=result || jsonb_build_object(k,coalesce((select jsonb_agg(payload order by position) from public.crm_records where owner_id=u and collection=k),'[]'::jsonb));
  end loop;
  return jsonb_build_object('revision',s.revision,'snapshot',result);
end $$;

create or replace function public.crm_commit(p_revision bigint,p_request uuid,p_snapshot jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare u uuid:=auth.uid(); s public.crm_state; k text; items jsonb;
begin
  if u is null or not exists(select 1 from public.crm_owners where user_id=u) then raise exception 'CRM_ACCESS_DENIED'; end if;
  if p_request is null or p_revision is null then raise exception 'CRM_INVALID_REQUEST'; end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' or jsonb_typeof(p_snapshot->'financeSettings') is distinct from 'object' or jsonb_typeof(p_snapshot->'meta') is distinct from 'object' then raise exception 'CRM_INVALID_SNAPSHOT'; end if;
  insert into public.crm_state(owner_id) values(u) on conflict do nothing;
  select * into s from public.crm_state where owner_id=u for update;
  if s.last_request=p_request then return s.revision; end if;
  if s.revision<>p_revision then raise exception 'CRM_CONFLICT' using errcode='40001'; end if;
  -- Validate the entire payload before touching records. Preserve arbitrary legacy fields.
  foreach k in array array['projectsActive','projectsCompleted','clients','specialists','partners','transactions','personalDebts','savings'] loop
    items:=p_snapshot->k;
    if jsonb_typeof(items) is distinct from 'array' then raise exception 'CRM_INVALID_COLLECTION %',k; end if;
    if exists(select 1 from jsonb_array_elements(items) e where jsonb_typeof(e)<>'object' or jsonb_typeof(e->'id') is distinct from 'string' or length(trim(e->>'id'))=0) then raise exception 'CRM_INVALID_ID %',k; end if;
    if exists(select 1 from jsonb_array_elements(items) e group by e->>'id' having count(*)>1) then raise exception 'CRM_DUPLICATE_ID %',k; end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(p_snapshot->'projectsActive') as act(item) join jsonb_array_elements(p_snapshot->'projectsCompleted') as done(item) on act.item->>'id'=done.item->>'id') then raise exception 'CRM_DUPLICATE_PROJECT_ID'; end if;
  foreach k in array array['projectsActive','projectsCompleted','clients','specialists','partners','transactions','personalDebts','savings'] loop
    items:=p_snapshot->k;
    delete from public.crm_records r where r.owner_id=u and r.collection=k and not exists(select 1 from jsonb_array_elements(items) e where e->>'id'=r.id);
    insert into public.crm_records(owner_id,collection,id,position,payload)
      select u,k,e->>'id',n::integer,e from jsonb_array_elements(items) with ordinality as t(e,n)
      on conflict(owner_id,collection,id) do update set position=excluded.position,payload=excluded.payload
      where crm_records.payload is distinct from excluded.payload or crm_records.position is distinct from excluded.position;
  end loop;
  update public.crm_state set revision=revision+1,last_request=p_request,settings=p_snapshot->'financeSettings',meta=(p_snapshot->'meta') || jsonb_build_object('lastSavedAt',now()) where owner_id=u returning revision into p_revision;
  return p_revision;
end $$;
revoke all on function public.crm_read() from public,anon;
revoke all on function public.crm_commit(bigint,uuid,jsonb) from public,anon;
grant execute on function public.crm_read() to authenticated;
grant execute on function public.crm_commit(bigint,uuid,jsonb) to authenticated;
-- Run after creating your CRM login in Authentication > Users > Add user.
-- This is separate from your Supabase dashboard login and database password.
do $$
declare u uuid;
begin
  select id into u from auth.users where lower(email)=lower('marcaknazar370@gmail.com');
  if u is null then raise exception 'Спочатку створіть користувача CRM в Authentication > Users'; end if;
  insert into public.crm_owners(user_id) values(u) on conflict do nothing;
end $$;

commit;
