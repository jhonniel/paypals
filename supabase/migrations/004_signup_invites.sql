-- =============================================================================
-- Paypals — Invite-only signup
-- =============================================================================

-- Track whether a profile completed invite verification
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS invite_verified boolean NOT NULL DEFAULT false;

-- Existing users keep access
UPDATE public.profiles SET invite_verified = true WHERE invite_verified = false;

-- App-level signup invite codes (admins issue these)
CREATE TABLE IF NOT EXISTS public.signup_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  label text,
  max_uses integer,
  use_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz,
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signup_invites_code_len CHECK (char_length(code) >= 4 AND char_length(code) <= 64),
  CONSTRAINT signup_invites_max_uses_positive CHECK (max_uses IS NULL OR max_uses > 0),
  CONSTRAINT signup_invites_use_count_nonneg CHECK (use_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_signup_invites_code_lower ON public.signup_invites (lower(code));
CREATE INDEX IF NOT EXISTS idx_signup_invites_enabled ON public.signup_invites (enabled);

ALTER TABLE public.signup_invites ENABLE ROW LEVEL SECURITY;

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

-- Validate invite without consuming (anon + authenticated)
CREATE OR REPLACE FUNCTION public.validate_signup_invite(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cleaned text := lower(trim(p_code));
  app_row public.signup_invites%ROWTYPE;
  group_row public.groups%ROWTYPE;
BEGIN
  IF cleaned IS NULL OR cleaned = '' THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'missing');
  END IF;

  SELECT * INTO app_row
  FROM public.signup_invites
  WHERE lower(code) = cleaned
  LIMIT 1;

  IF FOUND THEN
    IF NOT app_row.enabled THEN
      RETURN jsonb_build_object('valid', false, 'reason', 'disabled', 'kind', 'app');
    END IF;
    IF app_row.expires_at IS NOT NULL AND app_row.expires_at < now() THEN
      RETURN jsonb_build_object('valid', false, 'reason', 'expired', 'kind', 'app');
    END IF;
    IF app_row.max_uses IS NOT NULL AND app_row.use_count >= app_row.max_uses THEN
      RETURN jsonb_build_object('valid', false, 'reason', 'exhausted', 'kind', 'app');
    END IF;
    RETURN jsonb_build_object(
      'valid', true,
      'kind', 'app',
      'invite_id', app_row.id,
      'label', COALESCE(app_row.label, 'Paypals invite')
    );
  END IF;

  -- Also accept group invite codes (join after signup)
  SELECT * INTO group_row
  FROM public.groups
  WHERE lower(invite_code) = cleaned
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'valid', true,
      'kind', 'group',
      'group_id', group_row.id,
      'label', group_row.name
    );
  END IF;

  RETURN jsonb_build_object('valid', false, 'reason', 'not_found');
END;
$$;

-- Redeem invite for current user (sets invite_verified + optional group join)
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
  gid uuid;
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

  IF kind = 'app' THEN
    app_id := (validation->>'invite_id')::uuid;
    UPDATE public.signup_invites
    SET use_count = use_count + 1,
        updated_at = now()
    WHERE id = app_id
      AND enabled = true
      AND (expires_at IS NULL OR expires_at >= now())
      AND (max_uses IS NULL OR use_count < max_uses);

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'exhausted');
    END IF;
  ELSIF kind = 'group' THEN
    gid := (validation->>'group_id')::uuid;
    INSERT INTO public.group_members (group_id, user_id, role)
    VALUES (gid, uid, 'member')
    ON CONFLICT ON CONSTRAINT group_members_group_user_unique DO NOTHING;
  END IF;

  UPDATE public.profiles
  SET invite_verified = true,
      updated_at = now()
  WHERE id = uid;

  RETURN jsonb_build_object(
    'ok', true,
    'kind', kind,
    'group_id', gid,
    'label', validation->>'label'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_signup_invite(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_signup_invite(text) TO authenticated;

-- Seed a starter invite for local/demo (admins can revoke)
INSERT INTO public.signup_invites (code, label, max_uses, enabled)
VALUES ('PAYPALS', 'Default signup invite', 1000, true)
ON CONFLICT (code) DO NOTHING;

-- Feature flag
INSERT INTO public.feature_flags (key, enabled, description)
VALUES ('signup_requires_invite', true, 'Require an invite code to create an account')
ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled;
