-- Single-use, unique admin signup invites

-- Default new rows to one use
ALTER TABLE public.signup_invites
  ALTER COLUMN max_uses SET DEFAULT 1;

-- Existing unlimited / multi-use → single use (and disable already exhausted)
UPDATE public.signup_invites
SET max_uses = 1,
    updated_at = now()
WHERE max_uses IS NULL OR max_uses > 1;

UPDATE public.signup_invites
SET enabled = false,
    updated_at = now()
WHERE use_count >= COALESCE(max_uses, 1);

-- Redeem: bump use count, disable when exhausted (single-use → off after first use)
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
  new_count integer;
  v_max integer;
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
      updated_at = now(),
      enabled = CASE
        WHEN max_uses IS NOT NULL AND use_count + 1 >= max_uses THEN false
        ELSE enabled
      END
  WHERE id = app_id
    AND enabled = true
    AND (expires_at IS NULL OR expires_at >= now())
    AND (max_uses IS NULL OR use_count < max_uses)
  RETURNING created_by, use_count, max_uses INTO inviter, new_count, v_max;

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

NOTIFY pgrst, 'reload schema';
