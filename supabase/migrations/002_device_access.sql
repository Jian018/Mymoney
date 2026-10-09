begin;
-- Approved browser sessions map to the existing ledger owner; financial rows
-- retain their original owner ID even when a device is replaced or reset.
create table public.authorized_devices (
  device_user_id uuid primary key references auth.users(id) on delete cascade,
  owner_user_id uuid not null references public.app_owner(user_id) on delete cascade,
  label text not null default 'My iPhone' check(length(label) between 1 and 80),
  created_at timestamptz not null default now()
);
alter table public.authorized_devices enable row level security;
revoke all on public.authorized_devices from anon, authenticated;
grant all on public.authorized_devices to service_role;

create function public.current_owner_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select o.user_id from public.app_owner o
  join public.authorized_devices d on d.owner_user_id = o.user_id
  where d.device_user_id = (select auth.uid());
$$;
revoke all on function public.current_owner_id() from public;
grant execute on function public.current_owner_id() to authenticated;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.current_owner_id() is not null;
$$;

do $$ declare t text; begin
  foreach t in array array['categories','transactions','budgets','daily_checkins','notification_preferences','push_subscriptions'] loop
    execute format('drop policy owner_access on public.%I',t);
    execute format('create policy owner_access on public.%I for all to authenticated using (user_id = (select public.current_owner_id())) with check (user_id = (select public.current_owner_id()))',t);
  end loop;
end $$;
drop policy profile_read on public.profiles;
drop policy profile_update on public.profiles;
create policy profile_read on public.profiles for select to authenticated using(id = (select public.current_owner_id()));
create policy profile_update on public.profiles for update to authenticated using(id = (select public.current_owner_id())) with check(id = (select public.current_owner_id()));
drop policy log_read on public.notification_logs;
drop policy log_insert on public.notification_logs;
drop policy log_update on public.notification_logs;
create policy log_read on public.notification_logs for select to authenticated using(user_id = (select public.current_owner_id()));
create policy log_insert on public.notification_logs for insert to authenticated with check(user_id = (select public.current_owner_id()));
create policy log_update on public.notification_logs for update to authenticated using(user_id = (select public.current_owner_id())) with check(user_id = (select public.current_owner_id()));
commit;
