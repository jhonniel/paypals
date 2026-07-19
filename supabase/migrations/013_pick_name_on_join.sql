-- Allow owner to add placeholder members by name only.
-- Joiners pick an open seat when they use the group invite code, then claim items.

ALTER TABLE public.group_members
  DROP CONSTRAINT IF EXISTS group_members_user_or_guest;

ALTER TABLE public.group_members
  ADD CONSTRAINT group_members_user_or_guest CHECK (
    user_id IS NOT NULL OR guest_name IS NOT NULL
  );

-- Open (unclaimed) seats for an invite code
CREATE OR REPLACE FUNCTION public.get_open_seats_by_invite(p_code text)
RETURNS TABLE (
  member_id uuid,
  guest_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT gm.id AS member_id, gm.guest_name
  FROM public.groups g
  JOIN public.group_members gm ON gm.group_id = g.id
  WHERE lower(g.invite_code) = lower(trim(p_code))
    AND gm.user_id IS NULL
    AND gm.guest_name IS NOT NULL
  ORDER BY gm.joined_at ASC, gm.guest_name ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_open_seats_by_invite(text) TO authenticated;

-- Claim a named seat via group invite code (instead of creating a new member row)
CREATE OR REPLACE FUNCTION public.claim_seat_by_invite(p_code text, p_member_id uuid)
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
  seat_gid uuid;
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

  SELECT gm.group_id INTO seat_gid
  FROM public.group_members gm
  WHERE gm.id = p_member_id
    AND gm.user_id IS NULL
    AND gm.guest_name IS NOT NULL
  LIMIT 1;

  IF seat_gid IS NULL OR seat_gid <> gid THEN
    RAISE EXCEPTION 'Seat not found or already claimed';
  END IF;

  SELECT gm.id INTO existing
  FROM public.group_members gm
  WHERE gm.group_id = gid AND gm.user_id = uid
  LIMIT 1;

  IF existing IS NOT NULL THEN
    -- Already in group: drop the unused seat if they somehow re-pick
    IF existing <> p_member_id THEN
      DELETE FROM public.group_members WHERE id = p_member_id;
    END IF;
    PERFORM public.ensure_accepted_friendship(inviter, uid);
    RETURN gid;
  END IF;

  UPDATE public.group_members
  SET user_id = uid,
      claimed_at = now(),
      invite_token = NULL
  WHERE id = p_member_id;

  INSERT INTO public.activities (user_id, group_id, action, metadata)
  VALUES (
    uid,
    gid,
    'member_joined',
    jsonb_build_object('via', 'pick_seat', 'member_id', p_member_id)
  );

  PERFORM public.ensure_accepted_friendship(inviter, uid);

  UPDATE public.profiles
  SET invite_verified = true, updated_at = now()
  WHERE id = uid;

  RETURN gid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_seat_by_invite(text, uuid) TO authenticated;
