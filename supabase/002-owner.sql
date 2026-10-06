-- Run after creating your CRM login in Authentication > Users > Add user.
-- This is separate from your Supabase dashboard login and database password.
do $$
declare u uuid;
begin
  select id into u from auth.users where lower(email)=lower('marcaknazar370@gmail.com');
  if u is null then raise exception 'Спочатку створіть користувача CRM в Authentication > Users'; end if;
  insert into public.crm_owners(user_id) values(u) on conflict do nothing;
end $$;
