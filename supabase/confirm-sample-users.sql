-- Confirm all Paypals sample users (run in Supabase SQL Editor)
-- Fixes: email_not_confirmed blocking login

UPDATE auth.users
SET email_confirmed_at = COALESCE(email_confirmed_at, now())
WHERE email IN (
  'alex@paypals.dev',
  'jordan@paypals.dev',
  'sam@paypals.dev',
  'morgan@paypals.dev',
  'casey@paypals.dev'
);
