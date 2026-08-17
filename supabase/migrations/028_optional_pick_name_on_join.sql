-- Open seats (manually added names) are optional when joining — pick if listed, or join as a new member.

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

  IF existing IS NOT NULL THEN
    IF to_regprocedure('public.ensure_accepted_friendship(uuid,uuid)') IS NOT NULL THEN
      PERFORM public.ensure_accepted_friendship(inviter, uid);
    END IF;
    RETURN gid;
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

GRANT EXECUTE ON FUNCTION public.join_group_by_invite(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
