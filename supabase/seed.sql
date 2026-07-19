-- =============================================================================
-- Paypals — Sample users & demo data
-- Run AFTER 001_initial_schema.sql in the Supabase SQL Editor.
-- Safe to re-run: deletes previous seed users by fixed UUIDs first.
-- =============================================================================
--
-- Login credentials (email / password):
--   alex@example.com      / Paypals123!
--   jordan@example.com    / Paypals123!
--   sam@example.com       / Paypals123!
--   morgan@example.com    / Paypals123!
--   casey@example.com     / Paypals123!   (admin)
--
-- =============================================================================

DO $$
DECLARE
  -- Fixed IDs so the seed is idempotent
  alex   uuid := '11111111-1111-1111-1111-111111111111';
  jordan uuid := '22222222-2222-2222-2222-222222222222';
  sam    uuid := '33333333-3333-3333-3333-333333333333';
  morgan uuid := '44444444-4444-4444-4444-444444444444';
  casey  uuid := '55555555-5555-5555-5555-555555555555';

  pwd text := crypt('Paypals123!', gen_salt('bf'));

  group_dinner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  group_travel uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  group_office uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';

  receipt_1 uuid := 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  receipt_2 uuid := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  receipt_3 uuid := 'ffffffff-ffff-ffff-ffff-ffffffffffff';
BEGIN
  -- --------------------------------------------------------------------------
  -- Cleanup previous seed (order matters: RESTRICT FKs on groups/receipts)
  -- --------------------------------------------------------------------------
  DELETE FROM public.receipt_item_assignments
  WHERE receipt_item_id IN (
    SELECT ri.id FROM public.receipt_items ri
    WHERE ri.receipt_id IN (receipt_1, receipt_2, receipt_3)
  );
  DELETE FROM public.receipt_items WHERE receipt_id IN (receipt_1, receipt_2, receipt_3);
  DELETE FROM public.receipt_images WHERE receipt_id IN (receipt_1, receipt_2, receipt_3);
  DELETE FROM public.receipt_history WHERE receipt_id IN (receipt_1, receipt_2, receipt_3);
  DELETE FROM public.ocr_logs WHERE receipt_id IN (receipt_1, receipt_2, receipt_3);
  DELETE FROM public.payments WHERE receipt_id IN (receipt_1, receipt_2, receipt_3);
  DELETE FROM public.activities WHERE receipt_id IN (receipt_1, receipt_2, receipt_3)
    OR group_id IN (group_dinner, group_travel, group_office)
    OR user_id IN (alex, jordan, sam, morgan, casey);
  DELETE FROM public.notifications WHERE user_id IN (alex, jordan, sam, morgan, casey);
  DELETE FROM public.receipts WHERE id IN (receipt_1, receipt_2, receipt_3);
  DELETE FROM public.group_members WHERE group_id IN (group_dinner, group_travel, group_office);
  DELETE FROM public.groups WHERE id IN (group_dinner, group_travel, group_office);
  DELETE FROM public.friends
  WHERE requester_id IN (alex, jordan, sam, morgan, casey)
     OR addressee_id IN (alex, jordan, sam, morgan, casey);
  DELETE FROM auth.users
  WHERE id IN (alex, jordan, sam, morgan, casey);

  -- --------------------------------------------------------------------------
  -- Auth users
  -- --------------------------------------------------------------------------
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
  ) VALUES
    (
      '00000000-0000-0000-0000-000000000000',
      alex,
      'authenticated',
      'authenticated',
      'alex@example.com',
      pwd,
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Alex Rivera"}'::jsonb,
      now() - interval '30 days',
      now(),
      '',
      '',
      '',
      ''
    ),
    (
      '00000000-0000-0000-0000-000000000000',
      jordan,
      'authenticated',
      'authenticated',
      'jordan@example.com',
      pwd,
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Jordan Lee"}'::jsonb,
      now() - interval '28 days',
      now(),
      '',
      '',
      '',
      ''
    ),
    (
      '00000000-0000-0000-0000-000000000000',
      sam,
      'authenticated',
      'authenticated',
      'sam@example.com',
      pwd,
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Sam Okonkwo"}'::jsonb,
      now() - interval '21 days',
      now(),
      '',
      '',
      '',
      ''
    ),
    (
      '00000000-0000-0000-0000-000000000000',
      morgan,
      'authenticated',
      'authenticated',
      'morgan@example.com',
      pwd,
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Morgan Chen"}'::jsonb,
      now() - interval '14 days',
      now(),
      '',
      '',
      '',
      ''
    ),
    (
      '00000000-0000-0000-0000-000000000000',
      casey,
      'authenticated',
      'authenticated',
      'casey@example.com',
      pwd,
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Casey Admin"}'::jsonb,
      now() - interval '7 days',
      now(),
      '',
      '',
      '',
      ''
    );

  -- Identities (required for email/password sign-in)
  INSERT INTO auth.identities (
    id,
    user_id,
    identity_data,
    provider,
    provider_id,
    last_sign_in_at,
    created_at,
    updated_at
  ) VALUES
    (alex, alex, format('{"sub":"%s","email":"alex@example.com","email_verified":true}', alex)::jsonb, 'email', alex::text, now(), now(), now()),
    (jordan, jordan, format('{"sub":"%s","email":"jordan@example.com","email_verified":true}', jordan)::jsonb, 'email', jordan::text, now(), now(), now()),
    (sam, sam, format('{"sub":"%s","email":"sam@example.com","email_verified":true}', sam)::jsonb, 'email', sam::text, now(), now(), now()),
    (morgan, morgan, format('{"sub":"%s","email":"morgan@example.com","email_verified":true}', morgan)::jsonb, 'email', morgan::text, now(), now(), now()),
    (casey, casey, format('{"sub":"%s","email":"casey@example.com","email_verified":true}', casey)::jsonb, 'email', casey::text, now(), now(), now());

  -- Enrich profiles (created by handle_new_user trigger)
  UPDATE public.profiles SET
    username = 'alex',
    bio = 'Organizes every group dinner.',
    is_admin = false
  WHERE id = alex;

  UPDATE public.profiles SET
    username = 'jordan',
    bio = 'Travel buddy and coffee snob.',
    is_admin = false
  WHERE id = jordan;

  UPDATE public.profiles SET
    username = 'sam',
    bio = 'Office lunch coordinator.',
    is_admin = false
  WHERE id = sam;

  UPDATE public.profiles SET
    username = 'morgan',
    bio = 'Splits fairly. Always.',
    is_admin = false
  WHERE id = morgan;

  UPDATE public.profiles SET
    username = 'casey',
    bio = 'Paypals platform admin.',
    is_admin = true
  WHERE id = casey;

  UPDATE public.user_settings SET currency = 'PHP', theme = 'system' WHERE user_id = alex;
  UPDATE public.user_settings SET currency = 'PHP', theme = 'dark' WHERE user_id = jordan;
  UPDATE public.user_settings SET currency = 'PHP', theme = 'light' WHERE user_id = sam;
  UPDATE public.user_settings SET currency = 'PHP', theme = 'dark' WHERE user_id = morgan;
  UPDATE public.user_settings SET currency = 'PHP', theme = 'system' WHERE user_id = casey;

  -- --------------------------------------------------------------------------
  -- Friends
  -- --------------------------------------------------------------------------
  INSERT INTO public.friends (requester_id, addressee_id, status) VALUES
    (alex, jordan, 'accepted'),
    (alex, sam, 'accepted'),
    (alex, morgan, 'accepted'),
    (jordan, sam, 'accepted'),
    (jordan, morgan, 'pending'),
    (sam, casey, 'accepted');

  -- --------------------------------------------------------------------------
  -- Groups + members
  -- --------------------------------------------------------------------------
  INSERT INTO public.groups (id, name, description, invite_code, created_by, created_at) VALUES
    (group_dinner, 'Friday Dinner', 'Weekly catch-up dinners', 'fridaydinner01', alex, now() - interval '20 days'),
    (group_travel, 'Tokyo Trip', 'Spring travel crew', 'tokyotrip2026', jordan, now() - interval '12 days'),
    (group_office, 'Office Lunches', 'Weekday team meals', 'officeteam01', sam, now() - interval '10 days');

  INSERT INTO public.group_members (group_id, user_id, role, joined_at) VALUES
    (group_dinner, alex, 'owner', now() - interval '20 days'),
    (group_dinner, jordan, 'admin', now() - interval '19 days'),
    (group_dinner, sam, 'member', now() - interval '18 days'),
    (group_dinner, morgan, 'member', now() - interval '17 days'),
    (group_travel, jordan, 'owner', now() - interval '12 days'),
    (group_travel, alex, 'member', now() - interval '11 days'),
    (group_travel, morgan, 'member', now() - interval '11 days'),
    (group_office, sam, 'owner', now() - interval '10 days'),
    (group_office, alex, 'member', now() - interval '9 days'),
    (group_office, casey, 'member', now() - interval '8 days');

  -- --------------------------------------------------------------------------
  -- Sample receipts
  -- --------------------------------------------------------------------------
  INSERT INTO public.receipts (
    id, group_id, created_by, merchant, receipt_date, currency,
    subtotal, tax, discount, service_charge, tip, total, status, ocr_confidence, created_at
  ) VALUES
    (
      receipt_1, group_dinner, alex, 'Osteria Verde',
      (current_date - 5)::date, 'PHP',
      86.00, 7.74, 0, 0, 14.00, 107.74, 'finalized', 94.50,
      now() - interval '5 days'
    ),
    (
      receipt_2, group_office, sam, 'Bento Box Co',
      (current_date - 2)::date, 'PHP',
      42.50, 3.40, 2.00, 0, 0, 43.90, 'edited', 91.20,
      now() - interval '2 days'
    ),
    (
      receipt_3, group_travel, jordan, 'Narita Express Cafe',
      (current_date - 1)::date, 'PHP',
      28.00, 0, 0, 0, 0, 28.00, 'uploaded', 88.00,
      now() - interval '1 day'
    );

  INSERT INTO public.receipt_items (receipt_id, name, quantity, unit_price, total_price, sort_order)
  VALUES
    (receipt_1, 'Margherita Pizza', 1, 18.00, 18.00, 1),
    (receipt_1, 'Truffle Pasta', 1, 24.00, 24.00, 2),
    (receipt_1, 'House Salad', 2, 9.00, 18.00, 3),
    (receipt_1, 'Sparkling Water', 4, 4.00, 16.00, 4),
    (receipt_1, 'Tiramisu', 2, 5.00, 10.00, 5);

  INSERT INTO public.receipt_items (receipt_id, name, quantity, unit_price, total_price, sort_order)
  VALUES
    (receipt_2, 'Chicken Bento', 2, 14.50, 29.00, 1),
    (receipt_2, 'Miso Soup', 2, 3.50, 7.00, 2),
    (receipt_2, 'Green Tea', 2, 3.25, 6.50, 3);

  INSERT INTO public.receipt_items (receipt_id, name, quantity, unit_price, total_price, sort_order)
  VALUES
    (receipt_3, 'Iced Latte', 2, 5.50, 11.00, 1),
    (receipt_3, 'Onigiri Set', 1, 9.00, 9.00, 2),
    (receipt_3, 'Pastry', 2, 4.00, 8.00, 3);

  INSERT INTO public.receipt_history (receipt_id, user_id, event, metadata) VALUES
    (receipt_1, alex, 'uploaded', '{"source":"seed"}'::jsonb),
    (receipt_1, alex, 'ocr_complete', '{"confidence":94.5}'::jsonb),
    (receipt_1, alex, 'finalized', '{}'::jsonb),
    (receipt_2, sam, 'uploaded', '{"source":"seed"}'::jsonb),
    (receipt_2, sam, 'edited', '{}'::jsonb),
    (receipt_3, jordan, 'uploaded', '{"source":"seed"}'::jsonb);

  INSERT INTO public.activities (user_id, group_id, receipt_id, action, metadata, created_at) VALUES
    (alex, group_dinner, receipt_1, 'receipt_finalized', '{"merchant":"Osteria Verde"}'::jsonb, now() - interval '5 days'),
    (sam, group_office, receipt_2, 'receipt_edited', '{"merchant":"Bento Box Co"}'::jsonb, now() - interval '2 days'),
    (jordan, group_travel, receipt_3, 'receipt_uploaded', '{"merchant":"Narita Express Cafe"}'::jsonb, now() - interval '1 day'),
    (alex, group_dinner, null, 'member_joined', '{"member":"morgan"}'::jsonb, now() - interval '17 days'),
    (jordan, group_travel, null, 'group_created', '{"name":"Tokyo Trip"}'::jsonb, now() - interval '12 days');

  INSERT INTO public.notifications (user_id, type, title, body, link) VALUES
    (alex, 'split_completed', 'Dinner split finalized', 'Osteria Verde is ready to settle.', '/receipts'),
    (jordan, 'invitation', 'Join Friday Dinner', 'Alex invited you to Friday Dinner.', '/groups'),
    (sam, 'receipt_updated', 'Bento Box Co updated', 'Sam edited items on the office lunch receipt.', '/receipts'),
    (morgan, 'member_joined', 'Welcome to Friday Dinner', 'You are now a member of Friday Dinner.', '/groups');

  RAISE NOTICE 'Paypals seed complete. Sign in as alex@example.com / Paypals123!';
END $$;
