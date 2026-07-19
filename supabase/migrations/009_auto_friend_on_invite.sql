-- =============================================================================
-- Auto-friend when someone joins via a group/guest invite
-- =============================================================================

ALTER TABLE public.group_members
  ADD COLUMN IF NOT EXISTS invited_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_group_members_invited_by
  ON public.group_members (invited_by);

-- Create or upgrade an accepted friendship between two users (either direction).
-- p_inviter is stored as requester when inserting a new row.
CREATE OR REPLACE FUNCTION public.ensure_accepted_friendship(
  p_inviter uuid,
  p_invitee uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_inviter IS NULL OR p_invitee IS NULL OR p_inviter = p_invitee THEN
    RETURN false;
  END IF;

  -- Don't touch blocked relationships
  IF EXISTS (
    SELECT 1
    FROM public.friends f
    WHERE f.status = 'blocked'
      AND (
        (f.requester_id = p_inviter AND f.addressee_id = p_invitee)
        OR (f.requester_id = p_invitee AND f.addressee_id = p_inviter)
      )
  ) THEN
    RETURN false;
  END IF;

  -- Already friends (or pending) — promote pending to accepted
  IF EXISTS (
    SELECT 1
    FROM public.friends f
    WHERE (f.requester_id = p_inviter AND f.addressee_id = p_invitee)
       OR (f.requester_id = p_invitee AND f.addressee_id = p_inviter)
  ) THEN
    UPDATE public.friends
    SET status = 'accepted',
        updated_at = now()
    WHERE status = 'pending'
      AND (
        (requester_id = p_inviter AND addressee_id = p_invitee)
        OR (requester_id = p_invitee AND addressee_id = p_inviter)
      );
    RETURN true;
  END IF;

  INSERT INTO public.friends (requester_id, addressee_id, status)
  VALUES (p_inviter, p_invitee, 'accepted');

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_accepted_friendship(uuid, uuid) TO authenticated;

-- Redeem signup invite: friend with group creator (or app invite creator)
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

  IF kind = 'app' THEN
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

    -- Personal app invites (not the shared PAYPALS seed) auto-friend the issuer
    IF inviter IS NOT NULL THEN
      PERFORM public.ensure_accepted_friendship(inviter, uid);
    END IF;
  ELSIF kind = 'group' THEN
    gid := (validation->>'group_id')::uuid;
    SELECT created_by INTO inviter FROM public.groups WHERE id = gid;

    INSERT INTO public.group_members (group_id, user_id, role, invited_by)
    VALUES (gid, uid, 'member', inviter)
    ON CONFLICT ON CONSTRAINT group_members_group_user_unique DO NOTHING;

    PERFORM public.ensure_accepted_friendship(inviter, uid);
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

-- Existing users joining via group invite code
CREATE OR REPLACE FUNCTION public.join_group_by_invite(p_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  gid uuid;
  uid uuid := auth.uid();
  existing uuid;
  inviter uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT g.id, g.created_by INTO gid, inviter
  FROM public.groups g
  WHERE lower(g.invite_code) = lower(trim(p_code))
  LIMIT 1;

  IF gid IS NULL THEN
    RAISE EXCEPTION 'Invalid invite code';
  END IF;

  SELECT gm.id INTO existing
  FROM public.group_members gm
  WHERE gm.group_id = gid AND gm.user_id = uid
  LIMIT 1;

  IF existing IS NULL THEN
    INSERT INTO public.group_members (group_id, user_id, role, invited_by)
    VALUES (gid, uid, 'member', inviter);

    INSERT INTO public.activities (user_id, group_id, action, metadata)
    VALUES (uid, gid, 'member_joined', jsonb_build_object('via', 'invite_code'));
  END IF;

  -- Always ensure friendship (even if already a member)
  PERFORM public.ensure_accepted_friendship(inviter, uid);

  RETURN gid;
END;
$$;

-- Guest seat claim: friend with who invited them (fallback: group creator)
CREATE OR REPLACE FUNCTION public.claim_guest_invite(p_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  mid uuid;
  gid uuid;
  inviter uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id, group_id, invited_by INTO mid, gid, inviter
  FROM public.group_members
  WHERE invite_token = trim(p_token)
    AND user_id IS NULL
  LIMIT 1;

  IF mid IS NULL THEN
    RAISE EXCEPTION 'Invite not found or already claimed';
  END IF;

  IF inviter IS NULL THEN
    SELECT created_by INTO inviter FROM public.groups WHERE id = gid;
  END IF;

  -- Already a member of this group?
  IF EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = gid AND user_id = uid
  ) THEN
    DELETE FROM public.group_members WHERE id = mid;
    SELECT id INTO mid FROM public.group_members WHERE group_id = gid AND user_id = uid LIMIT 1;
    PERFORM public.ensure_accepted_friendship(inviter, uid);
    UPDATE public.profiles
    SET invite_verified = true, updated_at = now()
    WHERE id = uid;
    RETURN mid;
  END IF;

  UPDATE public.group_members
  SET user_id = uid,
      claimed_at = now(),
      invite_token = NULL
  WHERE id = mid;

  PERFORM public.ensure_accepted_friendship(inviter, uid);

  UPDATE public.profiles
  SET invite_verified = true, updated_at = now()
  WHERE id = uid;

  RETURN mid;
END;
$$;
