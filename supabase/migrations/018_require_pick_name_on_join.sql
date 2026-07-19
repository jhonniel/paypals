-- Block joining without picking a name when open seats exist

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
  open_count integer;
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

  -- Already in the group — ok to return
  IF existing IS NOT NULL THEN
    IF to_regprocedure('public.ensure_accepted_friendship(uuid,uuid)') IS NOT NULL THEN
      PERFORM public.ensure_accepted_friendship(inviter, uid);
    END IF;
    RETURN gid;
  END IF;

  SELECT count(*)::integer INTO open_count
  FROM public.group_members gm
  WHERE gm.group_id = gid
    AND gm.user_id IS NULL
    AND gm.guest_name IS NOT NULL
    AND length(trim(gm.guest_name)) > 0;

  IF open_count > 0 THEN
    RAISE EXCEPTION 'PICK_SEAT: Pick your name on the bill to join this group';
  END IF;

  INSERT INTO public.group_members (group_id, user_id, role, invited_by)
  VALUES (gid, uid, 'member', inviter);

  INSERT INTO public.activities (user_id, group_id, action, metadata)
  VALUES (uid, gid, 'member_joined', jsonb_build_object('via', 'invite_code'));

  IF to_regprocedure('public.ensure_accepted_friendship(uuid,uuid)') IS NOT NULL THEN
    PERFORM public.ensure_accepted_friendship(inviter, uid);
  END IF;

  RETURN gid;
END;
$$;

-- Ensure open-seats RPC exists and is granted
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
    AND length(trim(gm.guest_name)) > 0
  ORDER BY gm.joined_at ASC, gm.guest_name ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_open_seats_by_invite(text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.join_group_by_invite(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
