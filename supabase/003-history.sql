begin;
-- ============================================================
-- Пакет 03: журнал історії змін і скасування (server-side).
--
-- ЗАСТОСУВАННЯ: після 001-crm.sql (наявна база) І ДО публікації
-- клієнта пакета 03. Старий клієнт працює і без цієї міграції;
-- новий клієнт без цієї міграції зберігає дані через резервну
-- стару сигнатуру crm_commit (без журналу) і покаже підказку
-- про відсутність журналу на відповідній вкладці.
--
-- Гарантії: подія створюється з ФАКТИЧНОЇ різниці в межах тієї ж
-- транзакції, що й запис даних (crm_commit) — успішний commit і
-- журнал атомарні; повтор того самого request ID не створює нової
-- події; crm_history_undo перевіряє власника, ревізію під
-- блокуванням, ідемпотентність і створює подію-відновлення також
-- атомарно. Доступ до таблиці — лише через SECURITY DEFINER функції
-- з перевіркою auth.uid() і crm_owners; anon/authenticated прямих
-- прав на crm_history не мають.
-- ============================================================

create table if not exists public.crm_history (
  owner_id uuid not null references public.crm_state(owner_id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  at timestamptz not null default now(),
  request_id uuid,
  revision bigint,
  action text not null check (action in ('create','update','delete','complete','payment','settings','import','restore','undo')),
  source text not null default 'Застасунок' check (source in ('Форма','Помічник','Імпорт','Система','Застасунок')),
  section text not null check (section in ('projects','clients','finance','specialists','partners','debts','savings','settings','import')),
  group_id uuid not null,
  summary text not null,
  changes jsonb not null default '[]'::jsonb,
  undone_by uuid,
  undone_event_id uuid,
  primary key (owner_id, id)
);
create index if not exists crm_history_owner_at on public.crm_history(owner_id, at desc);
alter table public.crm_history enable row level security;
revoke all on public.crm_history from anon, authenticated;

-- ------------------------------------------------------------
-- Довідники/валідація (без прав виконання в клієнтів).
-- ------------------------------------------------------------
create or replace function public.crm_history_source(p text) returns text
language sql immutable set search_path = '' as $$
  select case when trim(coalesce(p,'')) in ('Форма','Помічник','Імпорт','Система','Застасунок')
       then trim(p) else 'Застасунок' end;
$$;

create or replace function public.crm_collection_label(p text) returns text
language sql immutable set search_path = '' as $$
  select case p
    when 'projectsActive' then 'Активні проєкти'
    when 'projectsCompleted' then 'Завершені проєкти'
    when 'clients' then 'Клієнти'
    when 'specialists' then 'Фахівці'
    when 'partners' then 'Партнери'
    when 'transactions' then 'Фінанси'
    when 'personalDebts' then 'Борги'
    when 'savings' then 'Відкладення'
    when 'settings' then 'Налаштування фінансів'
    else p end;
$$;

create or replace function public.crm_history_label(p_collection text, p_payload jsonb) returns text
language sql immutable set search_path = '' as $$
  select coalesce(
    nullif(p_payload->>'name',''),
    nullif(p_payload->>'person',''),
    nullif(p_payload->>'description',''),
    nullif(p_payload->>'category',''),
    nullif(p_payload->>'id',''),
    p_collection);
$$;

-- ------------------------------------------------------------
-- Різниця даних → зміни події (дзеркалить lib/history/engine.ts).
-- ------------------------------------------------------------
create or replace function public.crm_history_diff_collection(p_collection text, p_old jsonb, p_new jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_result jsonb := '[]'::jsonb;
  v_rec jsonb;
  v_row record;
  v_key text;
  v_fields jsonb;
begin
  if coalesce(jsonb_array_length(p_old),0) = 0 and coalesce(jsonb_array_length(p_new),0) = 0 then
    return v_result;
  end if;
  -- створені
  for v_rec in select value from jsonb_array_elements(p_new) loop
    if not exists (select 1 from jsonb_array_elements(p_old) o where o.value->>'id' = v_rec->>'id') then
      v_result := v_result || jsonb_build_array(jsonb_build_object(
        'collection', p_collection, 'change', 'create', 'id', v_rec->>'id',
        'label', crm_history_label(p_collection, v_rec), 'after', v_rec));
    end if;
  end loop;
  -- видалені
  for v_rec in select value from jsonb_array_elements(p_old) loop
    if not exists (select 1 from jsonb_array_elements(p_new) n where n.value->>'id' = v_rec->>'id') then
      v_result := v_result || jsonb_build_array(jsonb_build_object(
        'collection', p_collection, 'change', 'delete', 'id', v_rec->>'id',
        'label', crm_history_label(p_collection, v_rec), 'before', v_rec));
    end if;
  end loop;
  -- змінені: лише різниця полів
  for v_row in
    select n.value as nn, o.value as oo
    from jsonb_array_elements(p_new) n
    join jsonb_array_elements(p_old) o on o.value->>'id' = n.value->>'id'
    where n.value is distinct from o.value
  loop
    v_fields := '[]'::jsonb;
    for v_key in
      select k from (
        select jsonb_object_keys(v_row.oo) as k
        union
        select jsonb_object_keys(v_row.nn) as k
      ) keys
    loop
      if (v_row.oo->v_key) is distinct from (v_row.nn->v_key) then
        v_fields := v_fields || jsonb_build_array(jsonb_build_object(
          'key', v_key, 'before', v_row.oo->v_key, 'after', v_row.nn->v_key));
      end if;
    end loop;
    if jsonb_array_length(v_fields) > 0 then
      v_result := v_result || jsonb_build_array(jsonb_build_object(
        'collection', p_collection, 'change', 'update', 'id', v_row.nn->>'id',
        'label', crm_history_label(p_collection, v_row.nn), 'fields', v_fields));
    end if;
  end loop;
  return v_result;
end $$;

create or replace function public.crm_history_diff_settings(p_old jsonb, p_new jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_fields jsonb := '[]'::jsonb;
  v_key text;
begin
  if p_old is null or p_new is null then return null; end if;
  -- Лише дозволені несекретні поля налаштувань.
  for v_key in select * from unnest(array['usdRate','eurRate','usdtRate','displayCurrency']) loop
    if (p_old->v_key) is distinct from (p_new->v_key) then
      v_fields := v_fields || jsonb_build_array(jsonb_build_object(
        'key', v_key, 'before', p_old->v_key, 'after', p_new->v_key));
    end if;
  end loop;
  if jsonb_array_length(v_fields) = 0 then return null; end if;
  return jsonb_build_object('collection','settings','id','settings','change','update',
    'label','Налаштування фінансів','fields',v_fields);
end $$;

create or replace function public.crm_history_bulk(p_changes jsonb) returns jsonb
language sql set search_path = '' as $$
  select coalesce(jsonb_agg(entry order by collection), '[]'::jsonb) from (
    select c->>'collection' as collection,
      jsonb_build_object(
        'collection', c->>'collection', 'id', c->>'collection', 'change', 'bulk',
        'label', crm_collection_label(c->>'collection'),
        'counts', jsonb_build_object(
          'added', count(*) filter (where c->>'change' = 'create'),
          'removed', count(*) filter (where c->>'change' = 'delete'),
          'changed', count(*) filter (where c->>'change' = 'update'))) as entry
    from jsonb_array_elements(p_changes) c
    group by c->>'collection'
  ) grouped;
$$;

create or replace function public.crm_history_section(p_changes jsonb) returns text
language sql set search_path = '' as $$
  select case coalesce((select c->>'collection' from jsonb_array_elements(p_changes) c limit 1), 'import')
    when 'projectsActive' then 'projects'
    when 'projectsCompleted' then 'projects'
    when 'transactions' then 'finance'
    when 'personalDebts' then 'debts'
    when 'settings' then 'settings'
    when 'import' then 'import'
    else (select c->>'collection' from jsonb_array_elements(p_changes) c limit 1) end;
$$;

create or replace function public.crm_history_action(p_changes jsonb, p_source text, p_hint text) returns text
language plpgsql set search_path = '' as $$
begin
  if p_source = 'Імпорт' then
    if p_hint in ('import','restore') then return p_hint; end if;
    return 'import';
  end if;
  if not exists (select 1 from jsonb_array_elements(p_changes) c where c->>'collection' <> 'settings') then
    return 'settings';
  end if;
  -- Завершення: перенесення проєкту між колекціями в одній групі.
  if exists (
    select 1 from jsonb_array_elements(p_changes) d
    where d->>'change' = 'delete' and d->>'collection' = 'projectsActive'
      and exists (select 1 from jsonb_array_elements(p_changes) c
                  where c->>'change' = 'create' and c->>'collection' = 'projectsCompleted' and c->>'id' = d->>'id')
  ) or exists (
    select 1 from jsonb_array_elements(p_changes) d
    where d->>'change' = 'delete' and d->>'collection' = 'projectsCompleted'
      and exists (select 1 from jsonb_array_elements(p_changes) c
                  where c->>'change' = 'create' and c->>'collection' = 'projectsActive' and c->>'id' = d->>'id')
  ) then
    return 'complete';
  end if;
  if p_hint = 'payment' and exists (
    select 1 from jsonb_array_elements(p_changes) c
    where c->>'collection' in ('projectsActive','projectsCompleted')
  ) then
    return 'payment';
  end if;
  if not exists (select 1 from jsonb_array_elements(p_changes) c where c->>'change' in ('delete','update')) then
    return 'create';
  end if;
  if not exists (select 1 from jsonb_array_elements(p_changes) c where c->>'change' in ('create','update')) then
    return 'delete';
  end if;
  return 'update';
end $$;

create or replace function public.crm_history_summary(p_action text, p_changes jsonb) returns text
language plpgsql set search_path = '' as $$
declare
  v_label text;
  v_extra text;
  v_added int;
  v_removed int;
  v_changed int;
  v_fields int;
  v_n int;
begin
  select
    coalesce(sum(coalesce((c->'counts'->>'added')::int, case when c->>'change'='create' then 1 else 0 end)),0),
    coalesce(sum(coalesce((c->'counts'->>'removed')::int, case when c->>'change'='delete' then 1 else 0 end)),0),
    coalesce(sum(coalesce((c->'counts'->>'changed')::int, case when c->>'change'='update' then 1 else 0 end)),0),
    coalesce(sum(jsonb_array_length(coalesce(c->'fields','[]'::jsonb))),0),
    count(*)
  into v_added, v_removed, v_changed, v_fields, v_n
  from jsonb_array_elements(p_changes) c;

  if p_action in ('import','restore') then
    return (case when p_action='restore' then 'Відновлення з копії' else 'Імпорт даних' end)
      || ' (+' || v_added || ' −' || v_removed || ' ~' || v_changed || ')';
  end if;

  select coalesce(
    (select c->>'label' from jsonb_array_elements(p_changes) c where c->>'change' <> 'bulk' limit 1),
    (select c->>'label' from jsonb_array_elements(p_changes) c limit 1),
    'запис') into v_label;

  if p_action = 'settings' then
    select coalesce(string_agg(x.label, ', ' order by x.k), 'змінено') into v_extra
    from (
      select distinct k, case k
        when 'usdRate' then 'курс USD'
        when 'eurRate' then 'курс EUR'
        when 'usdtRate' then 'курс USDT'
        when 'displayCurrency' then 'валюта відображення'
        else k end as label
      from (
        select f->>'key' as k
        from jsonb_array_elements(p_changes) c,
             lateral jsonb_array_elements(coalesce(c->'fields','[]'::jsonb)) f
      ) raw_keys
    ) x;
    return 'Налаштування: ' || v_extra;
  end if;

  v_extra := case when v_n > 1 and p_action <> 'complete' then ' · +' || (v_n - 1) else '' end;
  case p_action
    when 'create' then return 'Створено «' || v_label || '»' || v_extra;
    when 'delete' then return 'Видалено «' || v_label || '»' || v_extra;
    when 'complete' then return 'Завершено «' || v_label || '»';
    when 'payment' then return 'Оплата по «' || v_label || '»';
    when 'undo' then return 'Скасовано: «' || v_label || '»';
    else
      if v_fields = 1 then
        select f->>'key' into v_extra
        from jsonb_array_elements(p_changes) c,
             lateral jsonb_array_elements(coalesce(c->'fields','[]'::jsonb)) f
        limit 1;
        return 'Змінено «' || v_label || '»: ' || v_extra;
      elsif v_fields > 1 then
        return 'Змінено «' || v_label || '» (' || v_fields || ' пол.)';
      else
        return 'Змінено «' || v_label || '»' || v_extra;
      end if;
  end case;
end $$;

-- ОЧИЩЕННЯ: 90 днів / 2000 подій на власника, із захистом живих
-- recovery-посилань (подія, на яку посилається утримуване
-- відновлення, не видаляється).
create or replace function public.crm_history_cleanup(p_owner uuid) returns void
language plpgsql set search_path = '' as $$
declare v_cutoff timestamptz := now() - interval '90 days';
begin
  delete from public.crm_history h
  using (
    select id, at, undone_event_id,
           row_number() over (order by at desc, id desc) as rn
    from public.crm_history
    where owner_id = p_owner
  ) r
  where h.owner_id = p_owner and h.id = r.id
    and (r.at < v_cutoff or r.rn > 2000)
    and not exists (
      select 1 from public.crm_history k
      where k.owner_id = p_owner and k.undone_event_id = h.id
        and k.at >= v_cutoff
        and k.id in (
          select id from (
            select id, row_number() over (order by at desc, id desc) as rn
            from public.crm_history where owner_id = p_owner
          ) ranked
          where ranked.rn <= 2000 and ranked.at >= v_cutoff
        )
    );
end $$;

-- ------------------------------------------------------------
-- Застосування колекцій (спільно для commit і undo).
-- ------------------------------------------------------------
create or replace function public.crm_apply_collections(p_owner uuid, p_snapshot jsonb) returns void
language plpgsql set search_path = '' as $$
declare k text; items jsonb;
begin
  for k in
    select t.k from jsonb_object_keys(p_snapshot) t(k)
    where k in ('projectsActive','projectsCompleted','clients','specialists','partners','transactions','personalDebts','savings')
  loop
    items := p_snapshot->k;
    delete from public.crm_records r
    where r.owner_id = p_owner and r.collection = k
      and not exists (select 1 from jsonb_array_elements(items) e where e->>'id' = r.id);
    insert into public.crm_records(owner_id,collection,id,position,payload)
      select p_owner, k, e->>'id', n::integer, e
      from jsonb_array_elements(items) with ordinality as t(e,n)
      on conflict(owner_id,collection,id) do update set position=excluded.position,payload=excluded.payload
      where crm_records.payload is distinct from excluded.payload or crm_records.position is distinct from excluded.position;
  end loop;
end $$;

-- ------------------------------------------------------------
-- crm_commit: той самий запис + журнал з фактичної різниці
-- в ОДНІЙ транзакції. Стара 3-аргументна сигнатура видаляється, щоб
-- виклики з 3 аргументів (старий клієнт) йшли через нову функцію з
-- типовим p_source=null → «Застасунок».
-- ------------------------------------------------------------
drop function if exists public.crm_commit(bigint,uuid,jsonb);

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
  foreach k in array array['projectsActive','projectsCompleted','clients','specialists','partners','transactions','personalDebts','savings'] loop
    items:=p_snapshot->k;
    if jsonb_typeof(items) is distinct from 'array' then raise exception 'CRM_INVALID_COLLECTION %',k; end if;
    if exists(select 1 from jsonb_array_elements(items) e where jsonb_typeof(e)<>'object' or jsonb_typeof(e->>'id') is distinct from 'string' or length(trim(e->>'id'))=0) then raise exception 'CRM_INVALID_ID %',k; end if;
    if exists(select 1 from jsonb_array_elements(items) e group by e->>'id' having count(*)>1) then raise exception 'CRM_DUPLICATE_ID %',k; end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(p_snapshot->'projectsActive') as act(item) join jsonb_array_elements(p_snapshot->'projectsCompleted') as done(item) on act.item->>'id'=done.item->>'id') then raise exception 'CRM_DUPLICATE_PROJECT_ID'; end if;

  -- ==== Пакет 03: фактична різниця ДО зміни записів (та сама транзакція).
  v_source := public.crm_history_source(p_source);
  foreach k in array array['projectsActive','projectsCompleted','clients','specialists','partners','transactions','personalDebts','savings'] loop
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

-- ------------------------------------------------------------
-- Читання журналу (власник).
-- ------------------------------------------------------------
create or replace function public.crm_history_list(p_limit int,p_offset int,p_section text,p_action text,p_from text,p_to text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid:=auth.uid(); v_limit int; v_total bigint; v_events jsonb;
begin
  if u is null or not exists(select 1 from public.crm_owners where user_id=u) then raise exception 'CRM_ACCESS_DENIED'; end if;
  v_limit := least(greatest(coalesce(p_limit,20),1),200);
  select count(*) into v_total
  from public.crm_history h
  where h.owner_id = u
    and (p_section is null or h.section = p_section)
    and (p_action is null or h.action = p_action)
    and (p_from is null or h.at >= p_from::timestamptz)
    and (p_to is null or h.at <= p_to::timestamptz);
  select coalesce(jsonb_agg(e order by e->>'at' desc, e->>'id' desc),'[]'::jsonb) into v_events
  from (
    select jsonb_build_object(
      'id', h.id::text,
      'at', to_char(h.at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'requestId', case when h.request_id is null then null else h.request_id::text end,
      'revision', h.revision,
      'action', h.action,
      'source', h.source,
      'section', h.section,
      'summary', h.summary,
      'changes', h.changes,
      'group', h.group_id::text,
      'undoneBy', case when h.undone_by is null then null else h.undone_by::text end,
      'undoneEventId', case when h.undone_event_id is null then null else h.undone_event_id::text end
    ) as e
    from public.crm_history h
    where h.owner_id = u
      and (p_section is null or h.section = p_section)
      and (p_action is null or h.action = p_action)
      and (p_from is null or h.at >= p_from::timestamptz)
      and (p_to is null or h.at <= p_to::timestamptz)
    order by h.at desc, h.id desc
    limit v_limit offset greatest(coalesce(p_offset,0),0)
  ) page;
  return jsonb_build_object('events', v_events, 'total', v_total);
end $$;

create or replace function public.crm_history_get(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid:=auth.uid(); v_event jsonb;
begin
  if u is null or not exists(select 1 from public.crm_owners where user_id=u) then raise exception 'CRM_ACCESS_DENIED'; end if;
  select jsonb_build_object(
    'id', h.id::text,
    'at', to_char(h.at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'requestId', case when h.request_id is null then null else h.request_id::text end,
    'revision', h.revision,
    'action', h.action,
    'source', h.source,
    'section', h.section,
    'summary', h.summary,
    'changes', h.changes,
    'group', h.group_id::text,
    'undoneBy', case when h.undone_by is null then null else h.undone_by::text end,
    'undoneEventId', case when h.undone_event_id is null then null else h.undone_event_id::text end
  ) into v_event
  from public.crm_history h
  where h.owner_id = u and h.id = p_id;
  return v_event;
end $$;

-- ------------------------------------------------------------
-- Скасування: авторизація, ідемпотентність, ревізія під блокуванням,
-- атомарне «відновлення даних + нова подія».
-- Патч — лише зачеплені колекції (повні масиви) та/або financeSettings;
-- контент патчу — відповідальність клієнтського engine, сервер додає
-- лише перевірки форми/цілісності (права власника той самий рівень,
-- що й звичайний commit).
-- ------------------------------------------------------------
create or replace function public.crm_history_undo(p_event_id uuid,p_request uuid,p_expected_revision bigint,p_source text,p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid:=auth.uid(); s public.crm_state; ev record;
  v_id uuid; v_rev bigint; v_key text; items jsonb;
  v_changes jsonb := '[]'::jsonb;
  v_old jsonb;
  v_set_old jsonb;
  v_set jsonb;
begin
  if u is null or not exists(select 1 from public.crm_owners where user_id=u) then raise exception 'CRM_ACCESS_DENIED'; end if;
  if p_event_id is null or p_request is null then raise exception 'CRM_INVALID_REQUEST'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or (select count(*) from jsonb_object_keys(p_patch) t(k)) = 0 then raise exception 'CRM_INVALID_PATCH'; end if;
  if exists (
    select 1 from jsonb_object_keys(p_patch) t(k)
    where k not in ('projectsActive','projectsCompleted','clients','specialists','partners','transactions','personalDebts','savings','financeSettings')
  ) then raise exception 'CRM_INVALID_PATCH'; end if;
  insert into public.crm_state(owner_id) values(u) on conflict do nothing;
  select * into s from public.crm_state where owner_id=u for update;

  -- Повтор того самого запиту скасування → без другої події.
  select id into v_id from public.crm_history where owner_id = u and request_id = p_request and action = 'undo';
  if v_id is not null then
    return jsonb_build_object('eventId', v_id::text, 'revision', s.revision, 'duplicate', true);
  end if;

  select * into ev from public.crm_history where owner_id = u and id = p_event_id;
  if not found then raise exception 'CRM_HISTORY_NOT_FOUND'; end if;
  if ev.action in ('import','restore','undo') then raise exception 'CRM_UNDO_NOT_ALLOWED'; end if;
  if ev.undone_by is not null then raise exception 'CRM_ALREADY_UNDONE'; end if;

  -- Перевірка ревізії ПІД БЛОКУВАННЯМ: клієнт розрахував патч на
  -- певному стані; будь-яка паралельна зміна → конфлікт, без запису.
  if p_expected_revision is not null and s.revision <> p_expected_revision then
    raise exception 'CRM_CONFLICT' using errcode='40001';
  end if;

  -- Валідація вмісту патчу (ті самі правила, що й для commit).
  for v_key in select t.k from jsonb_object_keys(p_patch) t(k) where k <> 'financeSettings' loop
    items := p_patch->v_key;
    if jsonb_typeof(items) is distinct from 'array' then raise exception 'CRM_INVALID_COLLECTION %',v_key; end if;
    if exists(select 1 from jsonb_array_elements(items) e where jsonb_typeof(e)<>'object' or jsonb_typeof(e->>'id') is distinct from 'string' or length(trim(e->>'id'))=0) then raise exception 'CRM_INVALID_ID %',v_key; end if;
    if exists(select 1 from jsonb_array_elements(items) e group by e->>'id' having count(*)>1) then raise exception 'CRM_DUPLICATE_ID %',v_key; end if;
  end loop;
  if p_patch ? 'projectsActive' then
    if exists (
      select 1 from jsonb_array_elements(p_patch->'projectsActive') e
      join public.crm_records r on r.owner_id = u and r.collection = 'projectsCompleted' and r.id = e->>'id'
    ) then raise exception 'CRM_DUPLICATE_PROJECT_ID'; end if;
  end if;
  if p_patch ? 'projectsCompleted' then
    if exists (
      select 1 from jsonb_array_elements(p_patch->'projectsCompleted') e
      join public.crm_records r on r.owner_id = u and r.collection = 'projectsActive' and r.id = e->>'id'
    ) then raise exception 'CRM_DUPLICATE_PROJECT_ID'; end if;
  end if;
  if p_patch ? 'projectsActive' and p_patch ? 'projectsCompleted' then
    if exists (
      select 1 from jsonb_array_elements(p_patch->'projectsActive') a
      join jsonb_array_elements(p_patch->'projectsCompleted') d on a->>'id' = d->>'id'
    ) then raise exception 'CRM_DUPLICATE_PROJECT_ID'; end if;
  end if;
  if p_patch ? 'financeSettings' and jsonb_typeof(p_patch->'financeSettings') is distinct from 'object' then
    raise exception 'CRM_INVALID_PATCH';
  end if;

  -- Старі значення зачеплених колекцій (для події-відновлення).
  v_old := '{}'::jsonb;
  for v_key in select t.k from jsonb_object_keys(p_patch) t(k) where k <> 'financeSettings' loop
    v_old := v_old || jsonb_build_object(v_key,
      coalesce((select jsonb_agg(payload) from public.crm_records where owner_id=u and collection=v_key),'[]'::jsonb));
  end loop;
  v_set_old := s.settings;

  -- Застосування патчу (порожній diff нижче → виняток → повний відкат).
  perform public.crm_apply_collections(u, p_patch - 'financeSettings');
  if p_patch ? 'financeSettings' then
    -- Злиття, а не заміна: невказані поля налаштувань зберігаються.
    update public.crm_state set settings = s.settings || p_patch->'financeSettings' where owner_id = u;
  end if;

  -- Подія-відновлення з ФАКТИЧНОЇ різниці старий→новий стан.
  for v_key in select t.k from jsonb_object_keys(v_old) t(k) loop
    v_changes := v_changes || public.crm_history_diff_collection(
      v_key,
      v_old->v_key,
      coalesce((select jsonb_agg(payload) from public.crm_records where owner_id=u and collection=v_key),'[]'::jsonb));
  end loop;
  if p_patch ? 'financeSettings' then
    -- Порівнюємо зі ЗЛИТОЮ новою валідністю (невказані поля зберігаються).
    v_set := public.crm_history_diff_settings(v_set_old, v_set_old || p_patch->'financeSettings');
    if v_set is not null then v_changes := v_changes || jsonb_build_array(v_set); end if;
  end if;
  if jsonb_array_length(v_changes) = 0 then
    raise exception 'CRM_UNDO_NO_CHANGES';
  end if;

  update public.crm_state
    set revision = revision + 1,
        meta = meta || jsonb_build_object('lastSavedAt', now())
    where owner_id = u
    returning revision into v_rev;

  v_id := gen_random_uuid();
  insert into public.crm_history(owner_id,id,at,request_id,revision,action,source,section,group_id,summary,changes,undone_event_id)
  values (u, v_id, now(), p_request, v_rev, 'undo', public.crm_history_source(p_source), ev.section, v_id,
          'Скасовано: «' || ev.summary || '»', v_changes, ev.id);
  update public.crm_history set undone_by = v_id where owner_id = u and id = p_event_id;
  perform public.crm_history_cleanup(u);

  return jsonb_build_object('eventId', v_id::text, 'revision', v_rev, 'duplicate', false);
end $$;

-- ------------------------------------------------------------
-- Права: журнал читається й скасовується лише через функції
-- з перевіркою власника; прямих прав у клієнтів немає.
-- ------------------------------------------------------------
revoke all on function public.crm_history_source(text) from public, anon, authenticated;
revoke all on function public.crm_collection_label(text) from public, anon, authenticated;
revoke all on function public.crm_history_label(text,jsonb) from public, anon, authenticated;
revoke all on function public.crm_history_diff_collection(text,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.crm_history_diff_settings(jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.crm_history_bulk(jsonb) from public, anon, authenticated;
revoke all on function public.crm_history_section(jsonb) from public, anon, authenticated;
revoke all on function public.crm_history_action(jsonb,text,text) from public, anon, authenticated;
revoke all on function public.crm_history_summary(text,jsonb) from public, anon, authenticated;
revoke all on function public.crm_history_cleanup(uuid) from public, anon, authenticated;
revoke all on function public.crm_apply_collections(uuid,jsonb) from public, anon, authenticated;

revoke all on function public.crm_commit(bigint,uuid,jsonb,text,text) from public, anon;
revoke all on function public.crm_history_list(int,int,text,text,text,text) from public, anon;
revoke all on function public.crm_history_get(uuid) from public, anon;
revoke all on function public.crm_history_undo(uuid,uuid,bigint,text,jsonb) from public, anon;
grant execute on function public.crm_commit(bigint,uuid,jsonb,text,text) to authenticated;
grant execute on function public.crm_history_list(int,int,text,text,text,text) to authenticated;
grant execute on function public.crm_history_get(uuid) to authenticated;
grant execute on function public.crm_history_undo(uuid,uuid,bigint,text,jsonb) to authenticated;
commit;
