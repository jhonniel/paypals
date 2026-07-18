-- =============================================================================
-- Paypals setup for project jnheovkogoqykswunmcg
-- Run this ENTIRE script in Supabase → SQL Editor → New query → Run
-- =============================================================================

-- 1) Confirm any existing auth users (if you signed up already)
UPDATE auth.users
SET email_confirmed_at = COALESCE(email_confirmed_at, now())
WHERE email_confirmed_at IS NULL;

-- 2) Create a ready-to-use demo user via Auth helpers is not available in SQL alone
--    without inserting into auth.users. This block creates one confirmed user.

DO $$
DECLARE
  uid uuid := 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  pwd text := crypt('Paypals123!', gen_salt('bf'));
BEGIN
  -- cleanup if re-run
  DELETE FROM auth.users WHERE id = uid OR email = 'alex@example.com';

  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    uid,
    'authenticated',
    'authenticated',
    'alex@example.com',
    pwd,
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Alex Rivera"}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    ''
  );

  INSERT INTO auth.identities (
    id,
    user_id,
    identity_data,
    provider,
    provider_id,
    last_sign_in_at,
    created_at,
    updated_at
  ) VALUES (
    uid,
    uid,
    format('{"sub":"%s","email":"alex@example.com","email_verified":true}', uid)::jsonb,
    'email',
    uid::text,
    now(),
    now(),
    now()
  );

  -- profile/settings may already exist via trigger; enrich if present
  UPDATE public.profiles
  SET username = 'alex', full_name = 'Alex Rivera'
  WHERE id = uid;

  RAISE NOTICE 'Demo user ready: alex@example.com / Paypals123!';
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'profiles table missing — run 001_initial_schema.sql first, then re-run this script';
  WHEN OTHERS THEN
    RAISE NOTICE 'Error: %', SQLERRM;
    RAISE;
END $$;
