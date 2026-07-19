-- Minimal fix: invited_by on group_members (+ friendship helper)
-- Safe to run after 014 — does NOT replace redeem_signup_invite.

ALTER TABLE public.group_members
  ADD COLUMN IF NOT EXISTS invited_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_group_members_invited_by
  ON public.group_members (invited_by);

-- Refresh PostgREST schema cache (fixes "schema cache" errors in the app)
NOTIFY pgrst, 'reload schema';

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

-- Verify
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'group_members'
  AND column_name = 'invited_by';
