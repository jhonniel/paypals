-- =============================================================================
-- Paypals — Who paid the bill + guest claim helper
-- =============================================================================

ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS paid_by_member_id uuid
    REFERENCES public.group_members (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_receipts_paid_by_member_id
  ON public.receipts (paid_by_member_id);

-- Claim a guest seat with invite_token after signup
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
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id, group_id INTO mid, gid
  FROM public.group_members
  WHERE invite_token = trim(p_token)
    AND user_id IS NULL
  LIMIT 1;

  IF mid IS NULL THEN
    RAISE EXCEPTION 'Invite not found or already claimed';
  END IF;

  -- Already a member of this group?
  IF EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = gid AND user_id = uid
  ) THEN
    DELETE FROM public.group_members WHERE id = mid;
    SELECT id INTO mid FROM public.group_members WHERE group_id = gid AND user_id = uid LIMIT 1;
    RETURN mid;
  END IF;

  UPDATE public.group_members
  SET user_id = uid,
      claimed_at = now(),
      invite_token = NULL
  WHERE id = mid;

  RETURN mid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_guest_invite(text) TO authenticated;

-- Preview guest invite without being a member yet
CREATE OR REPLACE FUNCTION public.get_guest_invite(p_token text)
RETURNS TABLE (
  member_id uuid,
  guest_name text,
  guest_email text,
  group_id uuid,
  group_name text,
  group_description text,
  claimed boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    gm.id,
    gm.guest_name,
    gm.guest_email,
    g.id,
    g.name,
    g.description,
    (gm.user_id IS NOT NULL OR gm.claimed_at IS NOT NULL)
  FROM public.group_members gm
  JOIN public.groups g ON g.id = gm.group_id
  WHERE gm.invite_token = trim(p_token)
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_guest_invite(text) TO anon, authenticated;
