begin;
-- ============================================================
-- Пакет 05: завдання — міграція колекції tasks.
-- ЗАСТОСУВАННЯ: після 004-hosting.sql і ДО публікації клієнта пакета 05.
-- НЕ видаляє й не перезаписує наявні дані: розширює CHECK колекцій і
-- додає tasks у read/commit/застосування (журнал історії — секція tasks;
-- залежностей у завдань немає). Сумісність: відсутність tasks-ключа
-- (старий клієнт) = «без змін»; явний порожній масив — перезапис.
-- ============================================================

-- 1) Розширення CHECK колекцій (без перезапису даних).
do $$
declare c record;
begin
  select con.conname as name
  into c
  from pg_constraint con
  where con.conrelid = 'public.crm_records'::regclass
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike 'CHECK%collection%'
    and pg_get_constraintdef(con.oid) like '%projectsActive%'
  limit 1;
  if c is not null then
    execute format('alter table public.crm_records drop constraint %I', c.name);
  end if;
end $$;
alter table public.crm_records
  add constraint crm_records_collection_check check (collection in ('projectsActive','projectsCompleted','clients','specialists','partners','transactions','personalDebts','savings','hostingServices','hostingPayments','tasks'));

-- 2) Секція журналу історії: «Завдання».
do $$
declare c record;
begin
  select con.conname as name
  into c
  from pg_constraint con
  where con.conrelid = 'public.crm_history'::regclass
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike 'CHECK%section%'
  limit 1;
  if c is not null then
    execute format('alter table public.crm_history drop constraint %I', c.name);
  end if;
end $$;
alter table public.crm_history
  add constraint crm_history_section_check check (section in ('projects','clients','finance','specialists','partners','debts','savings','hosting','tasks','settings','import'));

-- 3) Функції з урахуванням tasks (ті самі сигнатури → чинні grant).

create or replace function public.crm_read() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid:=auth.uid(); result jsonb; s public.crm_state; k text;
begin
  if u is null or not exists(select 1 from public.crm_owners where user_id=u) then raise exception 'CRM_ACCESS_DENIED'; end if;
  insert into public.crm_state(owner_id) values(u) on conflict do nothing;
  select * into s from public.crm_state where owner_id=u for share;
  result:=jsonb_build_object('financeSettings',s.settings,'meta',s.meta);
  foreach k in array array['projectsActive','projectsCompleted','clients','specialists','partners','transactions','personalDebts','savings','hostingServices','hostingPayments','tasks'] loop
    result:=result || jsonb_build_object(k,coalesce((select jsonb_agg(payload order by position) from public.crm_records where owner_id=u and collection=k),'[]'::jsonb));
  end loop;
  return jsonb_build_object('revision',s.revision,'snapshot',result);
end $$;

create or replace function public.crm_commit(p_revision bigint,p_request uuid,p_snapshot jsonb,p_source text default null,p_action text default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare u uuid:=auth.uid(); s public.crm_state; k text; items jsonb;
  v_changes jsonb := '[]'::jsonb;
  v_set jsonb;
  v_source text;
  v_action text;
  v_section text;
  v_id uuid;
begin
  if u is null or not exists(select 1 from public.crm_owners where user_id=u) then raise exception 'CRM_ACCESS_DENIED'; end if;
  if p_request is null or p_revision is null then raise exception 'CRM_INVALID_REQUEST'; end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' or jsonb_typeof(p_snapshot->'financeSettings') is distinct from 'object' or jsonb_typeof(p_snapshot->'meta') is distinct from 'object' then raise exception 'CRM_INVALID_SNAPSHOT'; end if;
  insert into public.crm_state(owner_id) values(u) on conflict do nothing;
  select * into s from public.crm_state where owner_id=u for update;
  -- Повтор того самого request ID: без нового запису й без нової події.
  if s.last_request=p_request then return s.revision; end if;
  if s.revision<>p_revision then raise exception 'CRM_CONFLICT' using errcode='40001'; end if;
  -- Validate the entire payload before touching records. Preserve arbitrary legacy fields.
  foreach k in array array['projectsActive','projectsCompleted','clients','specialists','partners','transactions','personalDebts','savings','hostingServices','hostingPayments','tasks'] loop
    if not (p_snapshot ? k) then
      -- Пакет 04: відсутність нових колекцій (старий клієнт) = «без змін»;
      -- старі колекції обов'язкові (старий клієнт завжди їх надсилає).
      if k in ('projectsActive','projectsCompleted','clients','specialists','partners','transactions','personalDebts','savings') then
        raise exception 'CRM_INVALID_COLLECTION %',k;
      end if;
      continue;
    end if;
    items:=p_snapshot->k;
    if jsonb_typeof(items) is distinct from 'array' then raise exception 'CRM_INVALID_COLLECTION %',k; end if;
    if exists(select 1 from jsonb_array_elements(items) e where jsonb_typeof(e)<>'object' or jsonb_typeof(e->'id') is distinct from 'string' or length(trim(e->>'id'))=0) then raise exception 'CRM_INVALID_ID %',k; end if;
    if exists(select 1 from jsonb_array_elements(items) e group by e->>'id' having count(*)>1) then raise exception 'CRM_DUPLICATE_ID %',k; end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(p_snapshot->'projectsActive') as act(item) join jsonb_array_elements(p_snapshot->'projectsCompleted') as done(item) on act.item->>'id'=done.item->>'id') then raise exception 'CRM_DUPLICATE_PROJECT_ID'; end if;

  -- ==== Пакет 03: фактична різниця ДО зміни записів (та сама транзакція).
  v_source := public.crm_history_source(p_source);
  foreach k in array array['projectsActive','projectsCompleted','clients','specialists','partners','transactions','personalDebts','savings','hostingServices','hostingPayments','tasks'] loop
    if not (p_snapshot ? k) then continue; end if;
    v_changes := v_changes || public.crm_history_diff_collection(
      k,
      coalesce((select jsonb_agg(payload) from public.crm_records where owner_id=u and collection=k),'[]'::jsonb),
      p_snapshot->k);
  end loop;
  v_set := public.crm_history_diff_settings(s.settings, p_snapshot->'financeSettings');
  if v_set is not null then v_changes := v_changes || jsonb_build_array(v_set); end if;

  if jsonb_array_length(v_changes) > 0 then
    v_action := public.crm_history_action(v_changes, v_source, p_action);
    v_section := case when v_action in ('import','restore') then 'import'
                      else public.crm_history_section(v_changes) end;
    -- Імпорт і занадто великі групи: лише підсумок (без повного JSON).
    if v_source = 'Імпорт' or jsonb_array_length(v_changes) > 50 or length(v_changes::text) > 98304 then
      v_changes := public.crm_history_bulk(v_changes);
    end if;
    v_id := gen_random_uuid();
    insert into public.crm_history(owner_id,id,at,request_id,revision,action,source,section,group_id,summary,changes)
    values (
      u, v_id, now(), p_request, p_revision + 1, v_action, v_source, v_section, v_id,
      public.crm_history_summary(v_action, v_changes), v_changes);
    perform public.crm_history_cleanup(u);
  end if;
  -- ==== Кінець блоку журналу.

  perform public.crm_apply_collections(u, p_snapshot);
  update public.crm_state set revision=revision+1,last_request=p_request,settings=p_snapshot->'financeSettings',meta=(p_snapshot->'meta') || jsonb_build_object('lastSavedAt',now()) where owner_id=u returning revision into p_revision;
  return p_revision;
end $$;

create or replace function public.crm_apply_collections(p_owner uuid, p_snapshot jsonb) returns void
language plpgsql set search_path = '' as $$
declare v_key text; items jsonb;
begin
  for v_key in
    select t.k from jsonb_object_keys(p_snapshot) t(k)
    where t.k in ('projectsActive','projectsCompleted','clients','specialists','partners','transactions','personalDebts','savings','hostingServices','hostingPayments','tasks')
  loop
    items := p_snapshot->v_key;
    delete from public.crm_records r
    where r.owner_id = p_owner and r.collection = v_key
      and not exists (select 1 from jsonb_array_elements(items) e where e->>'id' = r.id);
    insert into public.crm_records(owner_id,collection,id,position,payload)
      select p_owner, v_key, e->>'id', n::integer, e
      from jsonb_array_elements(items) with ordinality as t(e,n)
      on conflict(owner_id,collection,id) do update set position=excluded.position,payload=excluded.payload
      where crm_records.payload is distinct from excluded.payload or crm_records.position is distinct from excluded.position;
  end loop;
end $$;
commit;
