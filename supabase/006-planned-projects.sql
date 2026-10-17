begin;
-- ============================================================
-- Пакет 06: заплановані проєкти — міграція колекції plannedProjects.
-- ЗАСТОСУВАННЯ: після 005-tasks.sql і ДО публікації клієнта пакета 06.
-- НЕ видаляє й не перезаписує наявні дані: розширює CHECK колекцій і
-- додає plannedProjects у read/commit/застосування (журнал історії —
-- секція planned; залежність: clientId → clients, як у projects).
-- Старі tasks лишаються валідною колекцією (legacy) без показу в UI.
-- Сумісність: відсутність plannedProjects-ключа (старий клієнт) =
-- «без змін»; явний порожній масив — визначений перезапис.
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
  add constraint crm_records_collection_check check (collection in ('projectsActive','projectsCompleted','clients','specialists','partners','transactions','personalDebts','savings','hostingServices','hostingPayments','tasks','plannedProjects'));

-- 2) Секція журналу історії: «Заплановані проєкти» (planned).
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
  add constraint crm_history_section_check check (section in ('projects','clients','finance','specialists','partners','debts','savings','hosting','tasks','planned','settings','import'));

-- 3) Підписи колекцій (усі чинні + plannedProjects; старі tasks лишаються).
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
    when 'hostingServices' then 'Хостинг'
    when 'hostingPayments' then 'Оплати хостингу'
    when 'tasks' then 'Завдання'
    when 'plannedProjects' then 'Заплановані проєкти'
    when 'settings' then 'Налаштування фінансів'
    else p end;
$$;

-- 4) Секція події: plannedProjects → 'planned'; решта колекцій —
--    за наявними мапінгами (tasks — власна секція з пакета 05).
create or replace function public.crm_history_section(p_changes jsonb) returns text
language sql set search_path = '' as $$
  select case coalesce((select c->>'collection' from jsonb_array_elements(p_changes) c limit 1), 'import')
    when 'projectsActive' then 'projects'
    when 'projectsCompleted' then 'projects'
    when 'transactions' then 'finance'
    when 'personalDebts' then 'debts'
    when 'hostingServices' then 'hosting'
    when 'hostingPayments' then 'hosting'
    when 'plannedProjects' then 'planned'
    when 'settings' then 'settings'
    when 'import' then 'import'
    else coalesce((select c->>'collection' from jsonb_array_elements(p_changes) c limit 1), 'import') end;
$$;

-- 5) Функції з урахуванням plannedProjects (ті самі сигнатури → чинні grant).

create or replace function public.crm_read() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid:=auth.uid(); result jsonb; s public.crm_state; k text;
begin
  if u is null or not exists(select 1 from public.crm_owners where user_id=u) then raise exception 'CRM_ACCESS_DENIED'; end if;
  insert into public.crm_state(owner_id) values(u) on conflict do nothing;
  select * into s from public.crm_state where owner_id=u for share;
  result:=jsonb_build_object('financeSettings',s.settings,'meta',s.meta);
  foreach k in array array['projectsActive','projectsCompleted','clients','specialists','partners','transactions','personalDebts','savings','hostingServices','hostingPayments','tasks','plannedProjects'] loop
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
  foreach k in array array['projectsActive','projectsCompleted','clients','specialists','partners','transactions','personalDebts','savings','hostingServices','hostingPayments','tasks','plannedProjects'] loop
    if not (p_snapshot ? k) then
      -- Пакети 04–06: відсутність нових колекцій (старий клієнт) = «без змін»;
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
  foreach k in array array['projectsActive','projectsCompleted','clients','specialists','partners','transactions','personalDebts','savings','hostingServices','hostingPayments','tasks','plannedProjects'] loop
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
    where t.k in ('projectsActive','projectsCompleted','clients','specialists','partners','transactions','personalDebts','savings','hostingServices','hostingPayments','tasks','plannedProjects')
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

-- 6) Undo: plannedProjects посилається на clients через clientId —
--    ті самі правила залежностей, що й для проєктів.
create or replace function public.crm_history_undo(p_event_id uuid,p_request uuid,p_expected_revision bigint,p_source text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid:=auth.uid(); s public.crm_state; ev record;
  v_id uuid; v_rev bigint; v_key text; v_change jsonb; v_field jsonb;
  v_state jsonb := '{}'::jsonb;
  v_old_state jsonb;
  v_arr jsonb; v_rec jsonb; v_new_rec jsonb;
  v_settings jsonb;
  v_changes jsonb := '[]'::jsonb;
  v_set jsonb;
  v_proj_active jsonb; v_proj_done jsonb; v_projects jsonb;
  v_clients jsonb; v_specialists jsonb; v_partners jsonb; v_transactions jsonb;
  v_hosting_services jsonb; v_hosting_payments jsonb;
  v_planned jsonb;
begin
  if u is null or not exists(select 1 from public.crm_owners where user_id=u) then raise exception 'CRM_ACCESS_DENIED'; end if;
  if p_event_id is null or p_request is null or p_expected_revision is null then raise exception 'CRM_INVALID_REQUEST'; end if;
  insert into public.crm_state(owner_id) values(u) on conflict do nothing;
  select * into s from public.crm_state where owner_id=u for update;

  -- Повтор того самого запиту щодо ТОЇ САМОЇ події → без другої події.
  select id into v_id from public.crm_history
    where owner_id = u and request_id = p_request and action = 'undo' and undone_event_id = p_event_id;
  if v_id is not null then
    return jsonb_build_object('eventId', v_id::text, 'revision', s.revision, 'duplicate', true);
  end if;

  select * into ev from public.crm_history where owner_id = u and id = p_event_id;
  if not found then raise exception 'CRM_HISTORY_NOT_FOUND'; end if;
  if ev.action in ('import','restore','undo') then raise exception 'CRM_UNDO_NOT_ALLOWED'; end if;
  if ev.undone_by is not null then raise exception 'CRM_ALREADY_UNDONE'; end if;
  if exists (select 1 from jsonb_array_elements(ev.changes) c where c->>'change' = 'bulk') then
    raise exception 'CRM_UNDO_NOT_ALLOWED';
  end if;

  -- Перевірка ревізії ПІД БЛОКУВАННЯМ (обов'язкова): клієнт розрахував
  -- перегляд на певному стані; будь-яка паралельна зміна → конфлікт.
  if s.revision <> p_expected_revision then
    raise exception 'CRM_CONFLICT' using errcode='40001';
  end if;

  -- Завантажити зачеплені колекції як поточний (фінальний) стан.
  for v_key in select distinct c->>'collection' from jsonb_array_elements(ev.changes) c where c->>'collection' <> 'settings' loop
    v_state := v_state || jsonb_build_object(v_key,
      coalesce((select jsonb_agg(payload order by position) from public.crm_records where owner_id=u and collection=v_key),'[]'::jsonb));
  end loop;
  v_old_state := v_state;
  v_settings := s.settings;

  -- Обчислення інверсії кожної зміни події з перевіркою «після».
  for v_change in select value from jsonb_array_elements(ev.changes) loop
    if v_change->>'change' = 'bulk' then raise exception 'CRM_UNDO_NOT_ALLOWED'; end if;
    if v_change->>'collection' = 'settings' then
      for v_field in select value from jsonb_array_elements(coalesce(v_change->'fields','[]'::jsonb)) loop
        -- Подія старого формату (без прапорців наявності) — чесна відмова,
        -- не вгадування стану.
        if jsonb_typeof(v_field->'afterExists') is distinct from 'boolean'
           or jsonb_typeof(v_field->'beforeExists') is distinct from 'boolean' then
          raise exception 'CRM_UNDO_NOT_ALLOWED';
        end if;
        v_key := v_field->>'key';
        if (v_field->>'afterExists')::boolean then
          if (v_settings->v_key) is distinct from (v_field->'after') then
            raise exception 'CRM_UNDO_CHANGED';
          end if;
        else
          if (v_settings->v_key) is not null then
            raise exception 'CRM_UNDO_CHANGED';
          end if;
        end if;
        if (v_field->>'beforeExists')::boolean then
          v_settings := v_settings || jsonb_build_object(v_key, v_field->'before');
        else
          v_settings := v_settings #- array[v_key];
        end if;
      end loop;
    else
      v_arr := v_state->(v_change->>'collection');
      case v_change->>'change'
        when 'create' then
          -- Скасування створення: запис має існувати і відповідати «після».
          select e into v_rec from jsonb_array_elements(v_arr) e where e->>'id' = v_change->>'id';
          if not found then raise exception 'CRM_UNDO_CHANGED'; end if;
          if v_rec is distinct from (v_change->'after') then raise exception 'CRM_UNDO_CHANGED'; end if;
          v_arr := (select coalesce(jsonb_agg(t.e order by t.n), '[]'::jsonb)
                    from jsonb_array_elements(v_arr) with ordinality as t(e,n)
                    where t.e->>'id' <> v_change->>'id');
        when 'delete' then
          -- Скасування видалення: попередній ID має бути вільним.
          if exists (select 1 from jsonb_array_elements(v_arr) e where e->>'id' = v_change->>'id') then
            raise exception 'CRM_UNDO_CHANGED';
          end if;
          if jsonb_typeof(v_change->'before') is distinct from 'object' then raise exception 'CRM_UNDO_CHANGED'; end if;
          v_arr := v_arr || jsonb_build_array(v_change->'before');
        when 'update' then
          select e into v_rec from jsonb_array_elements(v_arr) e where e->>'id' = v_change->>'id';
          if not found then raise exception 'CRM_UNDO_CHANGED'; end if;
          v_new_rec := v_rec;
          for v_field in select value from jsonb_array_elements(coalesce(v_change->'fields','[]'::jsonb)) loop
            -- Подія старого формату (без прапорців наявності) — чесна відмова.
            if jsonb_typeof(v_field->'afterExists') is distinct from 'boolean'
               or jsonb_typeof(v_field->'beforeExists') is distinct from 'boolean' then
              raise exception 'CRM_UNDO_NOT_ALLOWED';
            end if;
            v_key := v_field->>'key';
            if (v_field->>'afterExists')::boolean then
              if (v_rec->v_key) is distinct from (v_field->'after') then
                raise exception 'CRM_UNDO_CHANGED';
              end if;
            else
              -- «Після» = відсутність поля: поточний запис теж не повинен його мати.
              if (v_rec->v_key) is not null then
                raise exception 'CRM_UNDO_CHANGED';
              end if;
            end if;
            if (v_field->>'beforeExists')::boolean then
              v_new_rec := v_new_rec || jsonb_build_object(v_key, v_field->'before');
            else
              -- «До» = відсутність поля: прибрати ключ, а не писати JSON-null.
              v_new_rec := v_new_rec #- array[v_key];
            end if;
          end loop;
          v_arr := (select coalesce(jsonb_agg(case when t.e->>'id' = v_change->>'id' then v_new_rec else t.e end order by t.n), '[]'::jsonb)
                    from jsonb_array_elements(v_arr) with ordinality as t(e,n));
        else
          raise exception 'CRM_UNDO_NOT_ALLOWED';
      end case;
      v_state := v_state || jsonb_build_object(v_change->>'collection', v_arr);
    end if;
  end loop;

  -- Фінальний стан для перевірок залежностей/унікальності:
  -- передана колекція — з v_state, непередана — поточна БД.
  v_proj_active := coalesce(v_state->'projectsActive',
    coalesce((select jsonb_agg(payload order by position) from public.crm_records where owner_id=u and collection='projectsActive'),'[]'::jsonb));
  v_proj_done := coalesce(v_state->'projectsCompleted',
    coalesce((select jsonb_agg(payload order by position) from public.crm_records where owner_id=u and collection='projectsCompleted'),'[]'::jsonb));
  v_projects := v_proj_active || v_proj_done;
  v_clients := coalesce(v_state->'clients',
    coalesce((select jsonb_agg(payload) from public.crm_records where owner_id=u and collection='clients'),'[]'::jsonb));
  v_specialists := coalesce(v_state->'specialists',
    coalesce((select jsonb_agg(payload) from public.crm_records where owner_id=u and collection='specialists'),'[]'::jsonb));
  v_partners := coalesce(v_state->'partners',
    coalesce((select jsonb_agg(payload) from public.crm_records where owner_id=u and collection='partners'),'[]'::jsonb));
  v_transactions := coalesce(v_state->'transactions',
    coalesce((select jsonb_agg(payload) from public.crm_records where owner_id=u and collection='transactions'),'[]'::jsonb));
  v_hosting_services := coalesce(v_state->'hostingServices',
    coalesce((select jsonb_agg(payload) from public.crm_records where owner_id=u and collection='hostingServices'),'[]'::jsonb));
  v_hosting_payments := coalesce(v_state->'hostingPayments',
    coalesce((select jsonb_agg(payload) from public.crm_records where owner_id=u and collection='hostingPayments'),'[]'::jsonb));
  v_planned := coalesce(v_state->'plannedProjects',
    coalesce((select jsonb_agg(payload) from public.crm_records where owner_id=u and collection='plannedProjects'),'[]'::jsonb));

  -- Унікальність ID проєктів між фінальними активними/завершеними.
  if v_state ? 'projectsActive' or v_state ? 'projectsCompleted' then
    if exists (
      select 1 from jsonb_array_elements(v_proj_active) a
      join jsonb_array_elements(v_proj_done) d on a->>'id' = d->>'id'
    ) then raise exception 'CRM_DUPLICATE_PROJECT_ID'; end if;
  end if;

  -- Залежності: прибрані записи (створення, яке скасовуємо) без зовнішніх посилань.
  for v_change in
    select value from jsonb_array_elements(ev.changes) c
    where c->>'change' = 'create' and c->>'collection' in ('clients','specialists','partners','projectsActive','projectsCompleted','hostingServices')
  loop
    if v_change->>'collection' in ('projectsActive','projectsCompleted') then
      -- Проєкт може «перейти» в іншу колекцію (скасування завершення) — тоді він не прибирається.
      if exists (select 1 from jsonb_array_elements(case when v_change->>'collection' = 'projectsActive' then v_proj_done else v_proj_active end) x
                 where x->>'id' = v_change->>'id') then
        continue;
      end if;
      if exists (select 1 from jsonb_array_elements(v_transactions) x where x->>'projectId' = v_change->>'id') then
        raise exception 'CRM_UNDO_DEPENDENCY';
      end if;
    elsif v_change->>'collection' = 'clients' then
      if exists (select 1 from jsonb_array_elements(v_projects) x where x->>'clientId' = v_change->>'id')
         or exists (select 1 from jsonb_array_elements(v_planned) x where x->>'clientId' = v_change->>'id') then
        raise exception 'CRM_UNDO_DEPENDENCY';
      end if;
    elsif v_change->>'collection' = 'specialists' then
      if exists (select 1 from jsonb_array_elements(v_projects) x where x->>'developerId' = v_change->>'id') then
        raise exception 'CRM_UNDO_DEPENDENCY';
      end if;
    elsif v_change->>'collection' = 'partners' then
      if exists (select 1 from jsonb_array_elements(v_projects) x where x->>'partnerId' = v_change->>'id') then
        raise exception 'CRM_UNDO_DEPENDENCY';
      end if;
    elsif v_change->>'collection' = 'hostingServices' then
      if exists (select 1 from jsonb_array_elements(v_hosting_payments) x where x->>'serviceId' = v_change->>'id') then
        raise exception 'CRM_UNDO_DEPENDENCY';
      end if;
    end if;
  end loop;

  -- Відновлені записи: їхні посилання мають бути валідними у фінальному стані.
  for v_change in select value from jsonb_array_elements(ev.changes) c where c->>'change' = 'delete' loop
    v_rec := v_change->'before';
    if v_change->>'collection' in ('projectsActive','projectsCompleted') then
      if coalesce(v_rec->>'clientId','') <> '' and not exists (select 1 from jsonb_array_elements(v_clients) x where x->>'id' = v_rec->>'clientId') then
        raise exception 'CRM_UNDO_DEPENDENCY';
      end if;
      if coalesce(v_rec->>'developerId','') <> '' and not exists (select 1 from jsonb_array_elements(v_specialists) x where x->>'id' = v_rec->>'developerId') then
        raise exception 'CRM_UNDO_DEPENDENCY';
      end if;
      if coalesce(v_rec->>'partnerId','') <> '' and not exists (select 1 from jsonb_array_elements(v_partners) x where x->>'id' = v_rec->>'partnerId') then
        raise exception 'CRM_UNDO_DEPENDENCY';
      end if;
    elsif v_change->>'collection' = 'transactions' then
      if coalesce(v_rec->>'projectId','') <> '' and not exists (select 1 from jsonb_array_elements(v_projects) x where x->>'id' = v_rec->>'projectId') then
        raise exception 'CRM_UNDO_DEPENDENCY';
      end if;
    elsif v_change->>'collection' = 'hostingPayments' then
      if coalesce(v_rec->>'serviceId','') <> '' and not exists (select 1 from jsonb_array_elements(v_hosting_services) x where x->>'id' = v_rec->>'serviceId') then
        raise exception 'CRM_UNDO_DEPENDENCY';
      end if;
    elsif v_change->>'collection' = 'plannedProjects' then
      if coalesce(v_rec->>'clientId','') <> '' and not exists (select 1 from jsonb_array_elements(v_clients) x where x->>'id' = v_rec->>'clientId') then
        raise exception 'CRM_UNDO_DEPENDENCY';
      end if;
    end if;
  end loop;

  -- Відновлювані поля-посилання в update-змінах.
  for v_change in select value from jsonb_array_elements(ev.changes) c where c->>'change' = 'update' and c->>'collection' <> 'settings' loop
    for v_field in select value from jsonb_array_elements(coalesce(v_change->'fields','[]'::jsonb)) f
                   where f->>'key' in ('clientId','developerId','partnerId','projectId','serviceId') and coalesce(f->>'before','') <> '' loop
      if v_field->>'key' = 'clientId' and not exists (select 1 from jsonb_array_elements(v_clients) x where x->>'id' = v_field->>'before') then
        raise exception 'CRM_UNDO_DEPENDENCY';
      elsif v_field->>'key' = 'developerId' and not exists (select 1 from jsonb_array_elements(v_specialists) x where x->>'id' = v_field->>'before') then
        raise exception 'CRM_UNDO_DEPENDENCY';
      elsif v_field->>'key' = 'partnerId' and not exists (select 1 from jsonb_array_elements(v_partners) x where x->>'id' = v_field->>'before') then
        raise exception 'CRM_UNDO_DEPENDENCY';
      elsif v_field->>'key' = 'projectId' and not exists (select 1 from jsonb_array_elements(v_projects) x where x->>'id' = v_field->>'before') then
        raise exception 'CRM_UNDO_DEPENDENCY';
      elsif v_field->>'key' = 'serviceId' and not exists (select 1 from jsonb_array_elements(v_hosting_services) x where x->>'id' = v_field->>'before') then
        raise exception 'CRM_UNDO_DEPENDENCY';
      end if;
    end loop;
  end loop;

  -- Застосування обчисленого інверсного стану (порожній diff → виняток → відкат).
  perform public.crm_apply_collections(u, v_state);

  -- Подія-відновлення з ФАКТИЧНОЇ різниці старий→новий стан.
  for v_key in select t.k from jsonb_object_keys(v_old_state) t(k) loop
    v_changes := v_changes || public.crm_history_diff_collection(
      v_key, v_old_state->v_key, v_state->v_key);
  end loop;
  if v_settings is distinct from s.settings then
    v_set := public.crm_history_diff_settings(s.settings, v_settings);
    if v_set is not null then v_changes := v_changes || jsonb_build_array(v_set); end if;
  end if;
  if jsonb_array_length(v_changes) = 0 then
    raise exception 'CRM_UNDO_NO_CHANGES';
  end if;

  update public.crm_state
    set revision = revision + 1,
        settings = case when v_settings is distinct from s.settings then v_settings else settings end,
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
commit;
