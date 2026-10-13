begin;
alter table public.transactions add column source text not null default 'cash',
  add column source_transaction_id text, add column imported_at timestamptz,
  add column merchant text not null default '', add column semantic_type text not null default 'manual' check(semantic_type in ('manual','expense','income','refund')),
  add column refund_of uuid references public.transactions(id) on delete restrict,
  add constraint refund_shape check((semantic_type = 'refund' and refund_of is not null and transaction_type = 'expense') or (semantic_type <> 'refund' and refund_of is null));
create table public.import_batches (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
 request_id uuid not null, source text not null, account text not null check(length(account) between 1 and 100),
 imported_at timestamptz not null default now(), history text not null,
 new_count integer not null default 0, duplicate_count integer not null default 0, pending_count integer not null default 0, excluded_count integer not null default 0,
 unique(user_id,request_id)
);
create table public.import_items (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
 batch_id uuid not null references public.import_batches(id) on delete cascade, source text not null, account text not null,
 exact_key text not null, source_transaction_id text, imported_at timestamptz not null default now(),
 transaction_date date, currency text check(currency in ('MYR','SGD')), amount numeric(14,2) check(amount>0), merchant text not null,
 original_amount text not null default '', original_currency text not null default '', original_date text not null default '',
 flow text not null check(flow in ('expense','income','refund','transfer','topup','unknown')),
 reference text not null default '', status text not null check(status in ('new','duplicate','pending','excluded')),
 reason text not null, candidate_ids uuid[] not null default '{}', transaction_id uuid references public.transactions(id) on delete set null,
 unique(user_id,source,account,exact_key)
);
create index import_pending on public.import_items(user_id,status,imported_at);
create index import_candidates on public.transactions(user_id,currency,amount,transaction_date);
create table public.import_connections (
 user_id uuid not null references public.profiles(id) on delete cascade, provider text not null check(provider='paypal'),
 app_fingerprint text not null, authorized_at timestamptz not null default now(), primary key(user_id,provider)
);
do $$ declare t text; begin
 foreach t in array array['import_batches','import_items','import_connections'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy owner_read on public.%I for select to authenticated using(user_id=(select public.current_owner_id()))',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
create view public.import_items_read with(security_invoker=true) as
 select id,batch_id,user_id,source,account,exact_key,source_transaction_id,imported_at,transaction_date,currency,amount::text as amount,merchant,flow,reference,status,reason,candidate_ids,transaction_id,original_amount,original_currency,original_date from public.import_items;
grant select on public.import_items_read to authenticated;
create or replace view public.transactions_read with(security_invoker=true) as
 select id,user_id,transaction_type,category_id,amount::text as amount,currency,description,transaction_date,created_at,updated_at,source,source_transaction_id,imported_at,merchant,semantic_type,refund_of from public.transactions;

-- Guard immutable import provenance and prevent editing/deleting imported money via manual CRUD.
create function public.guard_imported_money() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user = 'authenticated' and (case when tg_op='INSERT' then new.source <> 'cash' or new.semantic_type <> 'manual' when tg_op='DELETE' then old.source <> 'cash' or old.semantic_type <> 'manual' else old.source <> 'cash' or old.semantic_type <> 'manual' or new.source <> 'cash' or new.semantic_type <> 'manual' or new.source_transaction_id is not null or new.imported_at is not null end) then
  raise exception 'Use Auto Import review for imported transactions';
 end if;
 if tg_op='DELETE' then return old; end if;
 if tg_op='UPDATE' and exists(select 1 from public.transactions r where r.refund_of=old.id) then raise exception 'A refunded purchase cannot be edited'; end if;
 return new;
end $$;
create trigger guard_imported_money before insert or update or delete on public.transactions for each row execute function public.guard_imported_money();

create function public.run_import(p_request uuid,p_source text,p_account text,p_history text,p_rows jsonb) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare owner_id uuid := public.current_owner_id(); b public.import_batches; r jsonb; item_id uuid; tx uuid; cat uuid; matches uuid[]; old_item public.import_items; state text; why text; n integer:=0; d integer:=0; p integer:=0; e integer:=0;
begin
 if owner_id is null then raise exception 'Unauthorized'; end if;
 if p_source not in ('maybank','cimb','dbs','ocbc','uob','tng','grab','wise','paypal','shopee','lazada','csv') or length(p_account) not between 1 and 100 or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>1000 then raise exception 'Invalid import'; end if;
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text,0));
 select * into b from public.import_batches where user_id=owner_id and request_id=p_request;
 if found then return jsonb_build_object('id',b.id,'new',b.new_count,'duplicate',b.duplicate_count,'pending',b.pending_count,'excluded',b.excluded_count,'history',b.history); end if;
 insert into public.import_batches(user_id,request_id,source,account,history) values(owner_id,p_request,p_source,p_account,left(p_history,1000)) returning * into b;
 for r in select value from jsonb_array_elements(p_rows) loop
  tx:=null; cat:=null; matches:='{}'; why:=coalesce(r->>'reason',''); state:='pending';
  select * into old_item from public.import_items where user_id=owner_id and source=p_source and account=p_account and exact_key=r->>'exact_key';
  if found then
   if old_item.amount::text is distinct from (r->>'amount') or old_item.currency is distinct from (r->>'currency') or old_item.transaction_date::text is distinct from (r->>'transaction_date') or old_item.flow is distinct from (r->>'flow') or old_item.merchant is distinct from (r->>'merchant') then raise exception 'A source ID was reused with changed data. Correct the file or review the original import.'; end if;
   d:=d+1; continue;
  end if;
  if r->>'amount' is not null and r->>'currency' in ('MYR','SGD') and r->>'transaction_date' is not null then
   select coalesce(array_agg(t.id),'{}') into matches from public.transactions t where t.user_id=owner_id and t.currency=r->>'currency' and abs(t.transaction_date-(r->>'transaction_date')::date)<=3
    and (t.amount=(r->>'amount')::numeric
     or (length(r->>'merchant')>2 and lower(regexp_replace(coalesce(nullif(t.merchant,''),t.description),'[^[:alnum:]]','','g'))=lower(regexp_replace(r->>'merchant','[^[:alnum:]]','','g')))
     or (length(coalesce(r->>'reference',''))>0 and exists(select 1 from public.import_items previous where previous.user_id=owner_id and previous.transaction_id=t.id and previous.reference=r->>'reference')));
  end if;
  if why='' and r->>'flow' in ('transfer','topup') then state:='excluded'; why:='Explicit internal transfer or wallet top-up; no expense created';
  elsif r->>'flow'='refund' then why:=concat_ws('; ',nullif(why,''),'Link the original expense or exclude a refund already recorded');
  elsif cardinality(matches)>0 then why:=concat_ws('; ',nullif(why,''),'Possible matching purchase by amount, merchant or reference, including manual or another source');
  elsif exists(select 1 from public.import_items i where i.user_id=owner_id and i.status='pending' and i.currency=r->>'currency' and i.amount=(r->>'amount')::numeric and abs(i.transaction_date-(r->>'transaction_date')::date)<=3) then why:=concat_ws('; ',nullif(why,''),'Similar pending record; resolve it first');
  elsif why='' and r->>'flow' in ('expense','income') and length(r->>'merchant')>0 and (r->>'amount')::numeric>0 and r->>'currency' in ('MYR','SGD') and r->>'transaction_date' is not null then
   -- Merchant text is not evidence of a transfer/refund. Suspicious wording needs human review.
   if (r->>'merchant') ~* '(top.?up|transfer|refund|reversal|wallet|shopee|lazada|grab|paypal|touch.?n.?go|tng|wise|duitnow|paynow|interbank)' then why:='Payment platform, transfer or refund wording needs review';
   else
    select id into cat from public.categories where user_id=owner_id and transaction_type=r->>'flow' order by (name='Other') desc,created_at,id limit 1;
    if cat is not null then
     insert into public.transactions(user_id,request_id,transaction_type,category_id,amount,currency,description,transaction_date,source,source_transaction_id,imported_at,merchant,semantic_type)
      values(owner_id,gen_random_uuid(),r->>'flow',cat,(r->>'amount')::numeric,r->>'currency',r->>'merchant',(r->>'transaction_date')::date,p_source,r->>'source_transaction_id',now(),r->>'merchant',r->>'flow') returning id into tx;
     state:='new'; else why:='Create an appropriate category before approval'; end if;
   end if;
  end if;
  insert into public.import_items(user_id,batch_id,source,account,exact_key,source_transaction_id,transaction_date,currency,amount,merchant,flow,reference,status,reason,candidate_ids,transaction_id,original_amount,original_currency,original_date)
   values(owner_id,b.id,p_source,p_account,r->>'exact_key',r->>'source_transaction_id',(r->>'transaction_date')::date,r->>'currency',(r->>'amount')::numeric,left(r->>'merchant',200),r->>'flow',left(coalesce(r->>'reference',''),200),state,left(why,1000),matches,tx,left(coalesce(r->>'original_amount',r->>'amount',''),100),left(coalesce(r->>'original_currency',r->>'currency',''),30),left(coalesce(r->>'original_date',r->>'transaction_date',''),100)) returning id into item_id;
  if state='new' then n:=n+1; elsif state='excluded' then e:=e+1; else p:=p+1; end if;
 end loop;
 update public.import_batches set new_count=n,duplicate_count=d,pending_count=p,excluded_count=e where id=b.id;
 return jsonb_build_object('id',b.id,'new',n,'duplicate',d,'pending',p,'excluded',e,'history',b.history);
end $$;

create function public.review_import(p_item uuid,p_action text,p_target uuid default null,p_category uuid default null,p_date date default null,p_currency text default null,p_amount numeric default null,p_merchant text default null,p_kind text default null,p_separate_refund boolean default false) returns void
 language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=public.current_owner_id(); i public.import_items; original public.transactions; tx uuid; c uuid; kind text; a numeric; cur text; dt date; merchant_name text;
begin
 if owner_id is null then raise exception 'Unauthorized'; end if;
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text,0));
 select * into i from public.import_items where id=p_item and user_id=owner_id for update;
 if not found then raise exception 'Import item not found'; end if;
 if i.status<>'pending' then raise exception 'Already reviewed; refresh the queue'; end if;
 if p_action='exclude' then update public.import_items set status='excluded',reason='Excluded by user; no money counted' where id=i.id; return; end if;
 if p_action not in ('new','duplicate','refund') then raise exception 'Invalid review action'; end if;
 a:=coalesce(p_amount,i.amount); cur:=coalesce(p_currency,i.currency); dt:=coalesce(p_date,i.transaction_date); merchant_name:=coalesce(nullif(p_merchant,''),i.merchant); kind:=coalesce(p_kind,i.flow);
 if a is null or a<=0 or a>=1000000000000 or a<>round(a,2) or cur is null or cur not in ('MYR','SGD') or dt is null or dt>(now() at time zone 'Asia/Singapore')::date or length(merchant_name) not between 1 and 200 then raise exception 'Valid amount, MYR/SGD currency, non-future date and merchant are required'; end if;
 if p_action in ('duplicate','refund') then
  select * into original from public.transactions where id=p_target and user_id=owner_id;
  if not found or original.currency<>cur then raise exception 'Select an original transaction in the same currency'; end if;
  if p_action='duplicate' then
   if original.amount<>a or abs(original.transaction_date-dt)>3 then raise exception 'Duplicate must match amount, currency and date within three days'; end if;
   update public.import_items set status='duplicate',transaction_id=original.id,reason='Matched by user; counted once' where id=i.id; return;
  end if;
  if original.transaction_type<>'expense' or original.semantic_type='refund' or a+(select coalesce(sum(amount),0) from public.transactions where user_id=owner_id and refund_of=original.id)>original.amount then raise exception 'Refund exceeds the original expense or remaining refundable amount'; end if;
  if not coalesce(p_separate_refund,false) and exists(select 1 from public.transactions where user_id=owner_id and semantic_type='refund' and refund_of=original.id and currency=cur and amount=a and abs(transaction_date-dt)<=3) then raise exception 'A similar refund is already recorded. Match it as a duplicate, or explicitly confirm a separate refund.'; end if;
  kind:='expense'; c:=original.category_id;
 else
  if i.flow in ('refund','transfer','topup') then raise exception 'Known refunds must link an original expense; transfers and top-ups must be excluded'; end if;
  if kind not in ('expense','income') then raise exception 'Select expense or income. Transfers and top-ups should be excluded; refunds must link an original expense.'; end if;
  select id into c from public.categories where id=p_category and user_id=owner_id and transaction_type=kind;
  if c is null then raise exception 'Select a matching category'; end if;
 end if;
 insert into public.transactions(user_id,request_id,transaction_type,category_id,amount,currency,description,transaction_date,source,source_transaction_id,imported_at,merchant,semantic_type,refund_of)
 values(owner_id,gen_random_uuid(),kind,c,a,cur,merchant_name,dt,i.source,i.source_transaction_id,i.imported_at,merchant_name,case when p_action='refund' then 'refund' else kind end,case when p_action='refund' then original.id else null end) returning id into tx;
 update public.import_items set status='new',transaction_id=tx,reason=case when p_action='refund' then 'Refund linked; reduces expenses' else 'Approved as a separate transaction' end where id=i.id;
end $$;
revoke all on function public.run_import(uuid,text,text,text,jsonb) from public;
revoke all on function public.review_import(uuid,text,uuid,uuid,date,text,numeric,text,text,boolean) from public;
grant execute on function public.run_import(uuid,text,text,text,jsonb),public.review_import(uuid,text,uuid,uuid,date,text,numeric,text,text,boolean) to authenticated;
-- Cash creation shares the import lock, so simultaneous sync and manual save cannot race.
create function public.create_cash(p_request uuid,p_kind text,p_category uuid,p_amount numeric,p_currency text,p_date date,p_description text,p_confirm boolean default false) returns uuid
 language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=public.current_owner_id(); tx uuid;
begin
 if owner_id is null then raise exception 'Unauthorized'; end if;
 if p_request is null or p_kind not in ('expense','income') or p_amount is null or p_amount<=0 or p_amount>=1000000000000 or p_amount<>round(p_amount,2) or p_currency not in ('MYR','SGD') or p_date is null or p_date>(now() at time zone 'Asia/Singapore')::date or length(p_description)>500 then raise exception 'Invalid cash entry'; end if;
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text,0));
 select id into tx from public.transactions where user_id=owner_id and request_id=p_request;
 if found then return tx; end if;
 if not coalesce(p_confirm,false) and exists(select 1 from public.transactions where user_id=owner_id and source<>'cash' and semantic_type<>'refund' and currency=p_currency and amount=p_amount and abs(transaction_date-p_date)<=3) then raise exception 'A similar imported transaction already exists. Check Transactions, or confirm this is a separate purchase before saving.'; end if;
 insert into public.transactions(user_id,request_id,transaction_type,category_id,amount,currency,transaction_date,description)
 values(owner_id,p_request,p_kind,p_category,p_amount,p_currency,p_date,p_description) returning id into tx;
 return tx;
end $$;
revoke all on function public.create_cash(uuid,text,uuid,numeric,text,date,text,boolean) from public;
grant execute on function public.create_cash(uuid,text,uuid,numeric,text,date,text,boolean) to authenticated;
commit;
