-- Legacy email/password initialization only. For the current no-login version, use setup-device.sql.
-- Run AFTER 001_initial.sql and AFTER manually creating the sole Auth user.
-- Replace the UUID below with Authentication > Users > User UID.
insert into public.app_owner(singleton,user_id)
values(true,'00000000-0000-0000-0000-000000000000');
-- Verify initialization (SQL Editor uses administrative privileges).
select id,display_name from public.profiles;
select name,transaction_type from public.categories;
