begin;
-- Keep migration 003 and all historical imports/transactions. Retire only the old write API.
revoke execute on function public.run_import(uuid,text,text,text,jsonb) from authenticated;
revoke execute on function public.review_import(uuid,text,uuid,uuid,date,text,numeric,text,text,boolean) from authenticated;
revoke all on public.import_connections from authenticated;

create table public.gmail_connections (
 id uuid primary key default gen_random_uuid(), user_id uuid not null unique references public.profiles(id) on delete cascade,
 google_account_id text not null, email text not null, authorized_by_user_id uuid references auth.users(id),
 connection_status text not null check(connection_status in ('connected','reconnect_required','disconnected')),
 revision uuid not null default gen_random_uuid(), last_sync_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.gmail_private_tokens (
 connection_id uuid primary key references public.gmail_connections(id) on delete cascade,
 connection_revision uuid not null, ciphertext text not null, updated_at timestamptz not null default now()
);
create table public.gmail_oauth_states (
 state_hash text primary key, user_id uuid not null references public.profiles(id) on delete cascade,
 device_user_id uuid not null references auth.users(id) on delete cascade, encrypted_verifier text not null,
 nonce_hash text not null, connection_id uuid not null, expected_revision uuid, expires_at timestamptz not null, created_at timestamptz not null default now()
);
create table public.gmail_sync_runs (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
 request_id uuid not null, google_account_id text not null, connection_revision uuid not null,
 started_at timestamptz not null default now(), finished_at timestamptz, lease_expires_at timestamptz not null default now()+interval '5 minutes',
 scanned_count integer not null default 0, imported_count integer not null default 0, duplicate_count integer not null default 0,
 review_count integer not null default 0, failed_count integer not null default 0, ignored_count integer not null default 0,
 myr_total numeric(16,2) not null default 0, sgd_total numeric(16,2) not null default 0,
 status text not null check(status in ('running','completed','partial','failed','cancelled')), message text not null default '',
 unique(user_id,request_id)
);
create unique index gmail_one_active_sync on public.gmail_sync_runs(user_id) where status='running';
create table public.gmail_processed_messages (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
 google_account_id text not null, gmail_message_id text not null,
 processing_status text not null check(processing_status in ('imported','duplicate','review','failed','ignored','rejected')),
 parser_version text not null, processed_at timestamptz not null default now(), unique(user_id,google_account_id,gmail_message_id)
);
create table public.gmail_import_candidates (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
 google_account_id text not null, gmail_message_id text not null, sync_run_id uuid not null references public.gmail_sync_runs(id),
 source text not null, sender text not null, subject text not null, received_at timestamptz,
 merchant text not null, merchant_key text not null, transaction_date date, amount numeric(14,2) check(amount>0),
 currency text check(currency in ('MYR','SGD')), category_id uuid references public.categories(id) on delete set null,
 payment_status text not null check(payment_status in ('completed','pending','hold','refund','cancelled','topup','transfer','unknown')),
 reference text, reference_key text, confidence numeric(4,3) not null check(confidence between 0 and 1),
 evidence jsonb not null default '{}', reason text not null,
 review_status text not null check(review_status in ('approved','pending','duplicate','rejected','ignored')),
 candidate_ids uuid[] not null default '{}', transaction_id uuid references public.transactions(id) on delete set null,
 created_at timestamptz not null default now(), reviewed_at timestamptz, unique(user_id,google_account_id,gmail_message_id)
);
create index gmail_review_queue on public.gmail_import_candidates(user_id,review_status,created_at);
create index gmail_reference_lookup on public.gmail_import_candidates(user_id,reference_key);
alter table public.transactions add column gmail_message_id text, add column google_account_id text,
 add column source_reference text, add column merchant_key text not null default '', add column source_provider text;
create unique index gmail_exact_financial_source on public.transactions(user_id,source_transaction_id) where source='gmail' and source_transaction_id is not null;
create or replace view public.transactions_read with(security_invoker=true) as
 select id,user_id,transaction_type,category_id,amount::text as amount,currency,description,transaction_date,created_at,updated_at,source,source_transaction_id,imported_at,merchant,semantic_type,refund_of,gmail_message_id,google_account_id,source_reference,merchant_key,source_provider from public.transactions;

do $$ declare t text; begin
 foreach t in array array['gmail_connections','gmail_sync_runs','gmail_processed_messages','gmail_import_candidates'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('create policy owner_read on public.%I for select to authenticated using(user_id=(select public.current_owner_id()))',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
 foreach t in array array['gmail_private_tokens','gmail_oauth_states'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
create view public.gmail_candidates_read with(security_invoker=true) as
 select id,user_id,google_account_id,gmail_message_id,sync_run_id,source,sender,subject,received_at,merchant,merchant_key,transaction_date,amount::text as amount,currency,category_id,payment_status,reference,reference_key,confidence,reason,evidence,review_status,candidate_ids,transaction_id,created_at,reviewed_at from public.gmail_import_candidates;
create view public.gmail_runs_read with(security_invoker=true) as
 select id,user_id,request_id,google_account_id,started_at,finished_at,lease_expires_at,scanned_count,imported_count,duplicate_count,review_count,failed_count,ignored_count,myr_total::text as myr_total,sgd_total::text as sgd_total,status,message from public.gmail_sync_runs;
grant select on public.gmail_candidates_read,public.gmail_runs_read to authenticated;
revoke all on public.gmail_candidates_read,public.gmail_runs_read from anon;
create trigger gmail_connections_updated before update on public.gmail_connections for each row execute function public.touch_updated_at();

-- Add missing categories without renaming any existing category.
insert into public.categories(user_id,name,icon,color,transaction_type)
 select p.id,c.name,c.icon,c.color,'expense' from public.profiles p cross join (values ('Groceries','shopping','#7c976b'),('Travel','transport','#6c91b5')) c(name,icon,color)
 on conflict(user_id,name,transaction_type) do nothing;
create function public.gmail_new_categories() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.categories(user_id,name,icon,color,transaction_type) values(new.id,'Groceries','shopping','#7c976b','expense'),(new.id,'Travel','transport','#6c91b5','expense') on conflict(user_id,name,transaction_type) do nothing;
 return new;
end $$;
create trigger gmail_new_categories after insert on public.profiles for each row execute function public.gmail_new_categories();

create function public.gmail_start_sync(p_request uuid,p_owner uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=p_owner; c public.gmail_connections; r public.gmail_sync_runs;
begin
 if owner_id is null or not exists(select 1 from public.app_owner where user_id=owner_id) then raise exception 'Unauthorized'; end if;
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text,0));
 select * into r from public.gmail_sync_runs where user_id=owner_id and request_id=p_request;
 if found then return jsonb_build_object('id',r.id,'status',r.status,'existing',true); end if;
 select * into c from public.gmail_connections where user_id=owner_id and connection_status='connected';
 if not found then raise exception 'Gmail authorization required'; end if;
 update public.gmail_sync_runs set status='failed',finished_at=now(),message='Previous scan was interrupted; retrieve again to resume safely' where user_id=owner_id and status='running' and lease_expires_at<=now();
 if exists(select 1 from public.gmail_sync_runs where user_id=owner_id and status='running') then raise exception 'A Gmail scan is already running'; end if;
 insert into public.gmail_sync_runs(user_id,request_id,google_account_id,connection_revision,status) values(owner_id,p_request,c.google_account_id,c.revision,'running') returning * into r;
 return jsonb_build_object('id',r.id,'status',r.status,'existing',false);
end $$;

-- Called once per email by the server-only service client. An owner lock also serializes Cash writes.
create function public.gmail_commit_message(p_run uuid,p_message text,p_result text,p_candidate jsonb,p_owner uuid) returns text
 language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=p_owner; run public.gmail_sync_runs; previous public.gmail_processed_messages; c public.gmail_import_candidates; original public.transactions; matches uuid[]:='{}'; cat uuid; tx uuid; amount_value numeric; currency_value text; date_value date; state text:='pending'; result text:='review'; why text; exact_id text;
begin
 if owner_id is null or not exists(select 1 from public.app_owner where user_id=owner_id) then raise exception 'Unauthorized'; end if;
 if length(p_message) not between 1 and 200 or p_result not in ('candidate','failed','ignored','already') then raise exception 'Invalid Gmail message result'; end if;
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text,0));
 select * into run from public.gmail_sync_runs where id=p_run and user_id=owner_id and status='running' and lease_expires_at>now() for update;
 if not found or not exists(select 1 from public.gmail_connections where user_id=owner_id and google_account_id=run.google_account_id and revision=run.connection_revision and connection_status='connected') then raise exception 'Gmail scan is no longer authorized'; end if;
 select * into previous from public.gmail_processed_messages where user_id=owner_id and google_account_id=run.google_account_id and gmail_message_id=p_message;
 if found and previous.processing_status<>'failed' then
  update public.gmail_sync_runs set scanned_count=scanned_count+1,duplicate_count=duplicate_count+1 where id=run.id; return 'duplicate';
 end if;
 if p_result='already' then raise exception 'Message has not been processed'; end if;
 if p_result in ('failed','ignored') then
  insert into public.gmail_processed_messages(user_id,google_account_id,gmail_message_id,processing_status,parser_version) values(owner_id,run.google_account_id,p_message,p_result,'gmail-rules-1') on conflict(user_id,google_account_id,gmail_message_id) do update set processing_status=excluded.processing_status,processed_at=now();
  update public.gmail_sync_runs set scanned_count=scanned_count+1,failed_count=failed_count+case when p_result='failed' then 1 else 0 end,ignored_count=ignored_count+case when p_result='ignored' then 1 else 0 end where id=run.id;
  return p_result;
 end if;
 if p_candidate is null or length(p_candidate::text)>12000 then raise exception 'Invalid Gmail candidate'; end if;
 amount_value:=(p_candidate->>'amount')::numeric; currency_value:=p_candidate->>'currency'; date_value:=(p_candidate->>'transaction_date')::date;
 if amount_value is not null and (amount_value<=0 or amount_value>=1000000000000 or amount_value<>round(amount_value,2)) then raise exception 'Invalid Gmail amount'; end if;
 if currency_value is not null and currency_value not in ('MYR','SGD') then raise exception 'Unsupported Gmail currency'; end if;
 why:=left(coalesce(p_candidate->>'reason',''),1500);
 select id into cat from public.categories where user_id=owner_id and transaction_type='expense' and name=p_candidate->>'category' order by created_at,id limit 1;
 if cat is null then select id into cat from public.categories where user_id=owner_id and transaction_type='expense' and name='Other' order by created_at,id limit 1; end if;
 exact_id:=coalesce(nullif(p_candidate->>'reference_key',''),'message:'||run.google_account_id||':'||p_message);
 select * into original from public.transactions where user_id=owner_id and source='gmail' and source_transaction_id=exact_id;
 if found then
  if original.amount=amount_value and original.currency=currency_value and original.semantic_type=(case when p_candidate->>'payment_status'='refund' then 'refund' else 'expense' end) and abs(original.transaction_date-date_value)<=3 then state:='duplicate'; result:='duplicate'; tx:=original.id; why:='Identical source reference; linked to the existing financial entry';
  else why:=concat_ws('; ',nullif(why,''),'Source reference conflicts with an existing record; inspect the original email'); end if;
 elsif p_candidate->>'payment_status' in ('cancelled','topup','transfer','hold') then state:='ignored';result:='ignored';why:='Non-spending event: '||(p_candidate->>'payment_status');
 else
  if amount_value is not null and currency_value is not null and date_value is not null then
   select coalesce(array_agg(t.id),'{}') into matches from public.transactions t where t.user_id=owner_id and abs(t.transaction_date-date_value)<=3
    and ((t.currency=currency_value and t.amount=amount_value) or (length(p_candidate->>'merchant_key')>2 and coalesce(nullif(t.merchant_key,''),lower(regexp_replace(coalesce(nullif(t.merchant,''),t.description),'[^[:alnum:]]','','g')))=p_candidate->>'merchant_key') or (length(coalesce(p_candidate->>'reference',''))>0 and t.source_reference=p_candidate->>'reference'));
  end if;
  if cardinality(matches)>0 then why:=concat_ws('; ',nullif(why,''),'Possible duplicate across bank, shopping platform, wallet or manual Cash entry');
  elsif exists(select 1 from public.gmail_import_candidates i where i.user_id=owner_id and i.review_status='pending' and abs(i.transaction_date-date_value)<=3 and ((i.currency=currency_value and i.amount=amount_value) or (length(p_candidate->>'merchant_key')>2 and i.merchant_key=p_candidate->>'merchant_key'))) then why:=concat_ws('; ',nullif(why,''),'Similar email is pending review; resolve both before counting');
  elsif coalesce((p_candidate->>'auto_save')::boolean,false) and (p_candidate->>'confidence')::numeric>=0.95 and p_candidate->>'payment_status'='completed' and why='' and amount_value is not null and currency_value is not null and date_value is not null and date_value<=(now() at time zone 'Asia/Singapore')::date and cat is not null and length(p_candidate->>'merchant')>0 then
   insert into public.transactions(user_id,request_id,transaction_type,category_id,amount,currency,description,transaction_date,source,source_transaction_id,imported_at,merchant,merchant_key,semantic_type,gmail_message_id,google_account_id,source_reference,source_provider)
    values(owner_id,gen_random_uuid(),'expense',cat,amount_value,currency_value,p_candidate->>'merchant',date_value,'gmail',exact_id,now(),p_candidate->>'merchant',p_candidate->>'merchant_key','expense',p_message,run.google_account_id,p_candidate->>'reference',p_candidate->>'source') returning id into tx;
   state:='approved';result:='imported';
  else why:=concat_ws('; ',nullif(why,''),'Review required; no expense has been saved'); end if;
 end if;
 insert into public.gmail_import_candidates(user_id,google_account_id,gmail_message_id,sync_run_id,source,sender,subject,received_at,merchant,merchant_key,transaction_date,amount,currency,category_id,payment_status,reference,reference_key,confidence,evidence,reason,review_status,candidate_ids,transaction_id)
  values(owner_id,run.google_account_id,p_message,run.id,left(p_candidate->>'source',50),left(p_candidate->>'sender',300),left(p_candidate->>'subject',250),nullif(p_candidate->>'received_at','')::timestamptz,left(p_candidate->>'merchant',200),left(p_candidate->>'merchant_key',200),date_value,amount_value,currency_value,cat,p_candidate->>'payment_status',left(p_candidate->>'reference',100),left(p_candidate->>'reference_key',200),(p_candidate->>'confidence')::numeric,coalesce(p_candidate->'evidence','{}'),why,state,matches,tx) returning * into c;
 insert into public.gmail_processed_messages(user_id,google_account_id,gmail_message_id,processing_status,parser_version) values(owner_id,run.google_account_id,p_message,result,'gmail-rules-1') on conflict(user_id,google_account_id,gmail_message_id) do update set processing_status=excluded.processing_status,processed_at=now();
 update public.gmail_sync_runs set scanned_count=scanned_count+1,imported_count=imported_count+case when result='imported' then 1 else 0 end,duplicate_count=duplicate_count+case when result='duplicate' then 1 else 0 end,review_count=review_count+case when result='review' then 1 else 0 end,ignored_count=ignored_count+case when result='ignored' then 1 else 0 end,myr_total=myr_total+case when result='imported' and currency_value='MYR' then amount_value else 0 end,sgd_total=sgd_total+case when result='imported' and currency_value='SGD' then amount_value else 0 end where id=run.id;
 return result;
end $$;

create function public.gmail_finish_sync(p_run uuid,p_status text,p_message text,p_owner uuid) returns void language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=p_owner; run public.gmail_sync_runs;
begin
 if owner_id is null or not exists(select 1 from public.app_owner where user_id=owner_id) then raise exception 'Unauthorized'; end if;
 if p_status not in ('completed','partial','failed') then raise exception 'Invalid scan status'; end if;
 update public.gmail_sync_runs set status=p_status,finished_at=now(),message=left(p_message,1000) where id=p_run and user_id=owner_id and status='running' returning * into run;
 if not found then return; end if;
 if p_status='completed' then update public.gmail_connections set last_sync_at=now() where user_id=owner_id and revision=run.connection_revision and connection_status='connected'; end if;
end $$;

create function public.gmail_review(p_candidate uuid,p_action text,p_category uuid default null,p_target uuid default null,p_amount numeric default null,p_currency text default null,p_date date default null,p_merchant text default null,p_separate boolean default false,p_cross_currency boolean default false) returns void
 language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=public.current_owner_id(); i public.gmail_import_candidates; original public.transactions; a numeric; cur text; dt date; merchant_name text; cat uuid; tx uuid; exact_id text;
begin
 if owner_id is null then raise exception 'Unauthorized'; end if;
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text,0));
 select * into i from public.gmail_import_candidates where id=p_candidate and user_id=owner_id for update;
 if not found then raise exception 'Email candidate not found'; end if;
 if p_action='category' then
  select * into original from public.transactions where id=i.transaction_id and user_id=owner_id and source='gmail' and semantic_type='expense';
  if not found then raise exception 'Select an imported expense'; end if;
  select id into cat from public.categories where id=p_category and user_id=owner_id and transaction_type='expense';
  if cat is null then raise exception 'Select an expense category'; end if;
  update public.transactions set category_id=cat where user_id=owner_id and (id=original.id or refund_of=original.id);
  update public.gmail_import_candidates set category_id=cat where user_id=owner_id and transaction_id in(select id from public.transactions where id=original.id or refund_of=original.id);
  return;
 end if;
 if i.review_status<>'pending' then raise exception 'Already reviewed; refresh the list'; end if;
 if p_action='reject' then
  update public.gmail_import_candidates set review_status='rejected',reviewed_at=now(),reason='Rejected by user; no expense counted' where id=i.id;
  update public.gmail_processed_messages set processing_status='rejected' where user_id=owner_id and google_account_id=i.google_account_id and gmail_message_id=i.gmail_message_id; return;
 end if;
 if p_action not in ('approve','duplicate','refund') then raise exception 'Invalid review action'; end if;
 a:=coalesce(p_amount,i.amount);cur:=coalesce(p_currency,i.currency);dt:=coalesce(p_date,i.transaction_date);merchant_name:=coalesce(nullif(p_merchant,''),i.merchant);
 if a is null or a<=0 or a>=1000000000000 or a<>round(a,2) or cur is null or cur not in ('MYR','SGD') or dt is null or dt>(now() at time zone 'Asia/Singapore')::date or length(merchant_name) not between 1 and 200 then raise exception 'Valid amount, MYR/SGD currency, non-future date and merchant are required'; end if;
 if p_action in ('duplicate','refund') then
  select * into original from public.transactions where id=p_target and user_id=owner_id;
  if not found or original.transaction_type<>'expense' then raise exception 'Choose an original expense'; end if;
  if p_action='duplicate' then
   if abs(original.transaction_date-dt)>3 then raise exception 'Choose the same purchase within three days'; end if;
   if (i.payment_status='refund') is distinct from (original.semantic_type='refund') then raise exception 'Link a refund to an existing refund, or apply it to the original expense'; end if;
   if (original.currency<>cur or original.amount<>a) and not (coalesce(p_cross_currency,false) and i.payment_status<>'refund' and i.currency is distinct from original.currency) then raise exception 'A duplicate must match amount and currency, or explicitly confirm a foreign-currency settlement'; end if;
   update public.gmail_import_candidates set review_status='duplicate',transaction_id=original.id,reviewed_at=now(),reason=case when p_cross_currency then 'Foreign-currency settlement linked by user; original expense retained without conversion' else 'Source evidence linked by user; purchase counted once' end where id=i.id;
   update public.gmail_processed_messages set processing_status='duplicate' where user_id=owner_id and google_account_id=i.google_account_id and gmail_message_id=i.gmail_message_id; return;
  end if;
  if original.currency<>cur then raise exception 'Refund must use the original ledger currency; verify the amount without automatic conversion'; end if;
  if i.payment_status<>'refund' then raise exception 'Only a refund candidate can reduce spending'; end if;
  if original.transaction_type<>'expense' or original.semantic_type='refund' or a+(select coalesce(sum(amount),0) from public.transactions where user_id=owner_id and refund_of=original.id)>original.amount then raise exception 'Refund exceeds the remaining original expense'; end if;
  if not coalesce(p_separate,false) and exists(select 1 from public.transactions where user_id=owner_id and refund_of=original.id and amount=a and abs(transaction_date-dt)<=3) then raise exception 'Similar refund already exists; match it or confirm a separate refund'; end if;
  cat:=original.category_id;
 else
  if i.payment_status in ('refund','cancelled','topup','transfer','hold','pending') then raise exception 'This event is not a completed expense. Reject it or link a completed refund; a later completed receipt can be imported.'; end if;
  if not coalesce(p_separate,false) and (cardinality(i.candidate_ids)>0 or exists(select 1 from public.transactions t where t.user_id=owner_id and t.transaction_type='expense' and t.semantic_type<>'refund' and abs(t.transaction_date-dt)<=3 and ((t.currency=cur and t.amount=a) or coalesce(nullif(t.merchant_key,''),lower(regexp_replace(coalesce(nullif(t.merchant,''),t.description),'[^[:alnum:]]','','g')))=i.merchant_key))) then raise exception 'Possible duplicate; match the original or confirm a separate purchase'; end if;
  select id into cat from public.categories where id=p_category and user_id=owner_id and transaction_type='expense';
  if cat is null then raise exception 'Choose an expense category'; end if;
 end if;
 exact_id:=coalesce(i.reference_key,'message:'||i.google_account_id||':'||i.gmail_message_id);
 if exists(select 1 from public.transactions where user_id=owner_id and source='gmail' and source_transaction_id=exact_id) then raise exception 'This source identifier is already counted. Match the existing entry.'; end if;
 insert into public.transactions(user_id,request_id,transaction_type,category_id,amount,currency,description,transaction_date,source,source_transaction_id,imported_at,merchant,merchant_key,semantic_type,refund_of,gmail_message_id,google_account_id,source_reference,source_provider)
  values(owner_id,gen_random_uuid(),'expense',cat,a,cur,merchant_name,dt,'gmail',exact_id,i.created_at,merchant_name,lower(regexp_replace(merchant_name,'[^[:alnum:]]','','g')),case when p_action='refund' then 'refund' else 'expense' end,case when p_action='refund' then original.id else null end,i.gmail_message_id,i.google_account_id,i.reference,i.source) returning id into tx;
 update public.gmail_import_candidates set review_status='approved',reviewed_at=now(),transaction_id=tx,category_id=cat,reason=case when p_action='refund' then 'Refund linked; reduces original expense' else 'Approved by user' end where id=i.id;
 update public.gmail_processed_messages set processing_status='imported' where user_id=owner_id and google_account_id=i.google_account_id and gmail_message_id=i.gmail_message_id;
end $$;

create function public.gmail_disconnect() returns void language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=public.current_owner_id();
begin
 if owner_id is null then raise exception 'Unauthorized'; end if;
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text,0));
 update public.gmail_connections set connection_status='disconnected',revision=gen_random_uuid() where user_id=owner_id;
 delete from public.gmail_private_tokens where connection_id in(select id from public.gmail_connections where user_id=owner_id);
 delete from public.gmail_oauth_states where user_id=owner_id;
 update public.gmail_sync_runs set status='cancelled',finished_at=now(),message='Gmail disconnected; saved expenses and audit evidence retained' where user_id=owner_id and status='running';
end $$;
-- Gmail category correction is done by the owner-checked RPC; immutable money/provenance stays protected.
create or replace function public.guard_imported_money() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user='authenticated' and (case when tg_op='INSERT' then new.source<>'cash' or new.semantic_type<>'manual' or new.imported_at is not null or new.source_transaction_id is not null when tg_op='DELETE' then old.source<>'cash' or old.semantic_type<>'manual' else old.source<>'cash' or old.semantic_type<>'manual' or new.source<>'cash' or new.semantic_type<>'manual' or new.imported_at is not null or new.source_transaction_id is not null end) then raise exception 'Imported money is protected; use Gmail review/category correction'; end if;
 if tg_op='DELETE' then return old; end if;
 if tg_op='UPDATE' and exists(select 1 from public.transactions where refund_of=old.id) and (to_jsonb(new)-array['category_id','updated_at']) is distinct from (to_jsonb(old)-array['category_id','updated_at']) then raise exception 'A refunded expense cannot be changed'; end if;
 return new;
end $$;
revoke all on function public.gmail_review(uuid,text,uuid,uuid,numeric,text,date,text,boolean,boolean),public.gmail_disconnect() from public;
grant execute on function public.gmail_review(uuid,text,uuid,uuid,numeric,text,date,text,boolean,boolean),public.gmail_disconnect() to authenticated;
revoke all on function public.gmail_start_sync(uuid,uuid),public.gmail_commit_message(uuid,text,text,jsonb,uuid),public.gmail_finish_sync(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.gmail_start_sync(uuid,uuid),public.gmail_commit_message(uuid,text,text,jsonb,uuid),public.gmail_finish_sync(uuid,text,text,uuid) to service_role;
-- Service-only atomic OAuth completion: state is one-use, device/owner bound, and
-- connection revision prevents an in-flight callback from undoing Disconnect.
create function public.gmail_store_connection(p_state text,p_owner uuid,p_device uuid,p_google text,p_email text,p_ciphertext text,p_revision uuid) returns void language plpgsql security definer set search_path='' as $$
declare s public.gmail_oauth_states; c public.gmail_connections;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 select * into s from public.gmail_oauth_states where state_hash=p_state and user_id=p_owner and device_user_id=p_device and expires_at>now() for update;
 if not found then raise exception 'OAuth state expired or consumed'; end if;
 if not exists(select 1 from public.authorized_devices where device_user_id=p_device and owner_user_id=p_owner) and p_device<>p_owner then raise exception 'Unauthorized'; end if;
 select * into c from public.gmail_connections where user_id=p_owner;
 if c.revision is distinct from s.expected_revision then raise exception 'Connection changed; authorize again'; end if;
 insert into public.gmail_connections(id,user_id,google_account_id,email,authorized_by_user_id,connection_status,revision) values(s.connection_id,p_owner,p_google,p_email,p_device,'connected',p_revision)
 on conflict(user_id) do update set google_account_id=excluded.google_account_id,email=excluded.email,authorized_by_user_id=excluded.authorized_by_user_id,connection_status='connected',revision=excluded.revision,last_sync_at=null;
 insert into public.gmail_private_tokens(connection_id,connection_revision,ciphertext) values(s.connection_id,p_revision,p_ciphertext) on conflict(connection_id) do update set ciphertext=excluded.ciphertext,connection_revision=excluded.connection_revision,updated_at=now();
 delete from public.gmail_oauth_states where user_id=p_owner;
 update public.gmail_sync_runs set status='cancelled',finished_at=now(),message='Gmail account changed; retrieve again' where user_id=p_owner and status='running';
end $$;
revoke all on function public.gmail_store_connection(text,uuid,uuid,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.gmail_store_connection(text,uuid,uuid,text,text,text,uuid) to service_role;
commit;
