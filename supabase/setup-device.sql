-- Run after migrations 001 + 002, from the private Supabase SQL Editor.
-- Replace only this UUID with the Device ID shown on your installed iPhone app.
-- For a new ledger, the first approved device becomes its canonical owner.
-- For an existing ledger, this approves access WITHOUT moving/deleting records.
do $$
declare
  device_id uuid := '00000000-0000-0000-0000-000000000000';
  ledger_owner uuid;
begin
  if not exists(select 1 from auth.users where id = device_id) then
    raise exception 'Device ID does not exist. Bind the device in the app first.';
  end if;
  select user_id into ledger_owner from public.app_owner;
  if ledger_owner is null then
    insert into public.app_owner(singleton,user_id) values(true,device_id);
    ledger_owner := device_id;
  end if;
  insert into public.authorized_devices(device_user_id,owner_user_id,label)
    values(device_id,ledger_owner,'My iPhone')
    on conflict(device_user_id) do update set owner_user_id=excluded.owner_user_id;
end $$;
-- Copy this value to ALLOWED_USER_ID in Vercel, then redeploy.
select user_id as "ALLOWED_USER_ID" from public.app_owner;
