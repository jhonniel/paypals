-- =============================================================================
-- Signup invites bootstrap (safe, step-friendly)
-- Paste ALL of this into Supabase SQL Editor and run once.
-- =============================================================================

-- 1) Column on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS invite_verified boolean NOT NULL DEFAULT false;

UPDATE public.profiles
SET invite_verified = true
WHERE invite_verified IS DISTINCT FROM true;

-- 2) Table ONLY (no policies yet — so this always sticks)
CREATE TABLE IF NOT EXISTS public.signup_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  label text,
  max_uses integer DEFAULT 1,
  use_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz,
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Constraints (ignore if already there)
DO $$
BEGIN
  ALTER TABLE public.signup_invites
    ADD CONSTRAINT signup_invites_code_len
    CHECK (char_length(code) >= 4 AND char_length(code) <= 64);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.signup_invites
    ADD CONSTRAINT signup_invites_max_uses_positive
    CHECK (max_uses IS NULL OR max_uses > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.signup_invites
    ADD CONSTRAINT signup_invites_use_count_nonneg
    CHECK (use_count >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_signup_invites_code_lower
  ON public.signup_invites (lower(code));
CREATE INDEX IF NOT EXISTS idx_signup_invites_enabled
  ON public.signup_invites (enabled);

-- 3) Functions (admin-only signup; no group codes)
CREATE OR REPLACE FUNCTION public.validate_signup_invite(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cleaned text := lower(trim(p_code));
  v_id uuid;
  v_label text;
  v_enabled boolean;
  v_expires timestamptz;
  v_max integer;
  v_uses integer;
BEGIN
  IF cleaned IS NULL OR cleaned = '' THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'missing');
  END IF;

  SELECT id, label, enabled, expires_at, max_uses, use_count
  INTO v_id, v_label, v_enabled, v_expires, v_max, v_uses
  FROM public.signup_invites
  WHERE lower(code) = cleaned
  LIMIT 1;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'not_found');
  END IF;

  IF NOT v_enabled THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'disabled', 'kind', 'app');
  END IF;
  IF v_expires IS NOT NULL AND v_expires < now() THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'expired', 'kind', 'app');
  END IF;
  IF v_max IS NOT NULL AND v_uses >= v_max THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'exhausted', 'kind', 'app');
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'kind', 'app',
    'invite_id', v_id,
    'label', COALESCE(v_label, 'Paypals invite')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.redeem_signup_invite(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  cleaned text := lower(trim(p_code));
  validation jsonb;
  kind text;
  app_id uuid;
  inviter uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  validation := public.validate_signup_invite(cleaned);
  IF NOT COALESCE(validation->>'valid') THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', COALESCE(validation->>'reason', 'invalid')
    );
  END IF;

  kind := validation->>'kind';
  IF kind IS DISTINCT FROM 'app' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;

  app_id := (validation->>'invite_id')::uuid;

  UPDATE public.signup_invites
  SET use_count = use_count + 1,
      updated_at = now()
  WHERE id = app_id
    AND enabled = true
    AND (expires_at IS NULL OR expires_at >= now())
    AND (max_uses IS NULL OR use_count < max_uses)
  RETURNING created_by INTO inviter;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'exhausted');
  END IF;

  IF inviter IS NOT NULL
     AND to_regprocedure('public.ensure_accepted_friendship(uuid,uuid)') IS NOT NULL THEN
    PERFORM public.ensure_accepted_friendship(inviter, uid);
  END IF;

  UPDATE public.profiles
  SET invite_verified = true,
      updated_at = now()
  WHERE id = uid;

  RETURN jsonb_build_object(
    'ok', true,
    'kind', 'app',
    'group_id', null,
    'label', validation->>'label'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_signup_invite(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_signup_invite(text) TO authenticated;

-- 4) RLS policies (only if is_admin() exists)
ALTER TABLE public.signup_invites ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF to_regprocedure('public.is_admin()') IS NULL THEN
    RAISE NOTICE 'Skipping signup_invites RLS policies — public.is_admin() not found';
    RETURN;
  END IF;

  DROP POLICY IF EXISTS "signup_invites_select_admins" ON public.signup_invites;
  CREATE POLICY "signup_invites_select_admins"
    ON public.signup_invites FOR SELECT TO authenticated
    USING (public.is_admin());

  DROP POLICY IF EXISTS "signup_invites_insert_admins" ON public.signup_invites;
  CREATE POLICY "signup_invites_insert_admins"
    ON public.signup_invites FOR INSERT TO authenticated
    WITH CHECK (public.is_admin());

  DROP POLICY IF EXISTS "signup_invites_update_admins" ON public.signup_invites;
  CREATE POLICY "signup_invites_update_admins"
    ON public.signup_invites FOR UPDATE TO authenticated
    USING (public.is_admin()) WITH CHECK (public.is_admin());

  DROP POLICY IF EXISTS "signup_invites_delete_admins" ON public.signup_invites;
  CREATE POLICY "signup_invites_delete_admins"
    ON public.signup_invites FOR DELETE TO authenticated
    USING (public.is_admin());
END $$;

-- 5) No shared multi-use seed — admins create unique single-use codes in /admin

-- 6) Optional feature flag
DO $$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN
    INSERT INTO public.feature_flags (key, enabled, description)
    VALUES ('signup_requires_invite', true, 'Require an invite code to create an account')
    ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled;
  END IF;
END $$;

-- Verify
SELECT 'signup_invites ready' AS status, count(*) AS invite_rows
FROM public.signup_invites;
