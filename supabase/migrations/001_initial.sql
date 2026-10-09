begin;
create extension if not exists pgcrypto;

-- The single owner is assigned manually after creating the Auth account.
create table public.app_owner (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null unique references auth.users(id) on delete cascade
);
alter table public.app_owner enable row level security;
revoke all on public.app_owner from anon, authenticated;
create function public.is_owner() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.app_owner where user_id = (select auth.uid()));
$$;
revoke all on function public.is_owner() from public;
grant execute on function public.is_owner() to authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'My Money' check(length(display_name) between 1 and 80),
  timezone text not null default 'Asia/Singapore' check(timezone = 'Asia/Singapore'),
  default_currency text not null default 'MYR' check(default_currency in ('MYR','SGD')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.categories (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check(length(name) between 1 and 50), icon text not null default 'other',
  color text not null default '#27624b' check(color ~ '^#[a-fA-F0-9]{6}$'),
  transaction_type text not null check(transaction_type in ('income','expense')),
  created_at timestamptz not null default now(), unique(user_id,name,transaction_type), unique(id,user_id,transaction_type)
);
create table public.transactions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null default gen_random_uuid(), unique(user_id,request_id),
  transaction_type text not null check(transaction_type in ('income','expense')), category_id uuid not null,
  amount numeric(14,2) not null check(amount > 0), currency text not null check(currency in ('MYR','SGD')),
  description text not null default '' check(length(description) <= 500), transaction_date date not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(category_id,user_id,transaction_type) references public.categories(id,user_id,transaction_type) on delete restrict
);
create index transactions_user_date on public.transactions(user_id,transaction_date desc);
create index transactions_budget_lookup on public.transactions(user_id,currency,category_id,transaction_date);
create table public.budgets (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  category_id uuid, transaction_type text generated always as ('expense'::text) stored,
  month date not null check(extract(day from month) = 1), currency text not null check(currency in ('MYR','SGD')),
  limit_amount numeric(14,2) not null check(limit_amount > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(category_id,user_id,transaction_type) references public.categories(id,user_id,transaction_type) on delete restrict
);
create unique index budgets_category_unique on public.budgets(user_id,month,currency,category_id) where category_id is not null;
create unique index budgets_overall_unique on public.budgets(user_id,month,currency) where category_id is null;
create table public.daily_checkins (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  checkin_date date not null, status text not null check(status = 'completed'),
  has_unrecorded_spending boolean not null check(not has_unrecorded_spending), has_impulse_purchase boolean not null,
  notes text not null default '' check(length(notes) <= 1000), completed_at timestamptz not null default now(), unique(user_id,checkin_date)
);
create table public.notification_preferences (
  id uuid primary key default gen_random_uuid(), user_id uuid not null unique references public.profiles(id) on delete cascade,
  daily_reminder_enabled boolean not null default true, reminder_time time not null default '21:00',
  timezone text not null default 'Asia/Singapore' check(timezone = 'Asia/Singapore'), push_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique check(length(endpoint) <= 2000), p256dh text not null, auth text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index push_subscriptions_user on public.push_subscriptions(user_id);
create table public.notification_logs (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  notification_type text not null, notification_date date not null,
  status text not null check(status in ('pending','accepted','partial','failed')), sent_at timestamptz,
  unique(user_id,notification_type,notification_date)
);

create function public.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
do $$ declare t text; begin
  foreach t in array array['profiles','transactions','budgets','notification_preferences','push_subscriptions'] loop
    execute format('create trigger touch_updated_at before update on public.%I for each row execute function public.touch_updated_at()',t);
  end loop;
  foreach t in array array['categories','transactions','budgets','daily_checkins','notification_preferences','push_subscriptions'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy owner_access on public.%I for all to authenticated using (user_id = (select auth.uid()) and (select public.is_owner())) with check (user_id = (select auth.uid()) and (select public.is_owner()))',t);
    execute format('grant select,insert,update,delete on public.%I to authenticated',t);
    execute format('revoke all on public.%I from anon',t);
  end loop;
end $$;
alter table public.profiles enable row level security;
create policy profile_read on public.profiles for select to authenticated using(id = (select auth.uid()) and (select public.is_owner()));
create policy profile_update on public.profiles for update to authenticated using(id = (select auth.uid()) and (select public.is_owner())) with check(id = (select auth.uid()) and (select public.is_owner()));
grant select,update on public.profiles to authenticated;
revoke all on public.profiles from anon;
alter table public.notification_logs enable row level security;
create policy log_read on public.notification_logs for select to authenticated using(user_id = (select auth.uid()) and (select public.is_owner()));
-- Test routes use the authenticated client's RLS, never a service-role key.
create policy log_insert on public.notification_logs for insert to authenticated with check(user_id = (select auth.uid()) and (select public.is_owner()));
create policy log_update on public.notification_logs for update to authenticated using(user_id = (select auth.uid()) and (select public.is_owner())) with check(user_id = (select auth.uid()) and (select public.is_owner()));
grant select,insert,update on public.notification_logs to authenticated;
revoke all on public.notification_logs from anon;

-- Casting in PostgreSQL avoids a JSON floating-point round trip for money.
create view public.transactions_read with (security_invoker = true) as
  select id,user_id,transaction_type,category_id,amount::text as amount,currency,description,transaction_date,created_at,updated_at from public.transactions;
create view public.budgets_read with (security_invoker = true) as
  select id,user_id,category_id,month,currency,limit_amount::text as limit_amount,created_at,updated_at from public.budgets;
grant select on public.transactions_read,public.budgets_read to authenticated;
revoke all on public.transactions_read,public.budgets_read from anon;

create function public.initialize_owner() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id) values(new.user_id) on conflict(id) do nothing;
  insert into public.notification_preferences(user_id) values(new.user_id) on conflict(user_id) do nothing;
  insert into public.categories(user_id,name,icon,color,transaction_type) values
    (new.user_id,'Food','food','#d08b51','expense'), (new.user_id,'Transport','transport','#6c91b5','expense'),
    (new.user_id,'Shopping','shopping','#b682b0','expense'), (new.user_id,'Bills','bills','#c77878','expense'),
    (new.user_id,'Entertainment','entertainment','#9980bd','expense'), (new.user_id,'Other','other','#819086','expense'),
    (new.user_id,'Salary','salary','#27624b','income'), (new.user_id,'Other','other','#819086','income')
    on conflict(user_id,name,transaction_type) do nothing;
  return new;
end;
$$;
revoke all on function public.initialize_owner() from public;
create trigger initialize_owner after insert on public.app_owner for each row execute function public.initialize_owner();
-- Explicit administrative grants for cron; do not depend on project defaults.
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
commit;
