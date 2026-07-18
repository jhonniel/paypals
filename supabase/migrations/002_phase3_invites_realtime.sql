-- Phase 3: invite join helper (bypass select RLS for invite_code lookup)
CREATE OR REPLACE FUNCTION public.get_group_by_invite(p_code text)
RETURNS TABLE (
  id uuid,
  name text,
  description text,
  photo_url text,
  invite_code text,
  member_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    g.id,
    g.name,
    g.description,
    g.photo_url,
    g.invite_code,
    (SELECT count(*) FROM public.group_members gm WHERE gm.group_id = g.id) AS member_count
  FROM public.groups g
  WHERE lower(g.invite_code) = lower(trim(p_code))
  LIMIT 1;
$$;

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
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT g.id INTO gid
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
    RETURN gid;
  END IF;

  INSERT INTO public.group_members (group_id, user_id, role)
  VALUES (gid, uid, 'member');

  INSERT INTO public.activities (user_id, group_id, action, metadata)
  VALUES (uid, gid, 'member_joined', jsonb_build_object('via', 'invite_code'));

  RETURN gid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_group_by_invite(text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.join_group_by_invite(text) TO authenticated;

-- Allow members to update receipt assignments (collaborative splitting)
DROP POLICY IF EXISTS "receipt_item_assignments_insert_via_receipt" ON public.receipt_item_assignments;
DROP POLICY IF EXISTS "receipt_item_assignments_update_via_receipt" ON public.receipt_item_assignments;
DROP POLICY IF EXISTS "receipt_item_assignments_delete_via_receipt" ON public.receipt_item_assignments;

CREATE POLICY "receipt_item_assignments_insert_members"
  ON public.receipt_item_assignments
  FOR INSERT
  TO authenticated
  WITH CHECK (public.can_access_receipt(
    (SELECT ri.receipt_id FROM public.receipt_items ri WHERE ri.id = receipt_item_id)
  ));

CREATE POLICY "receipt_item_assignments_update_members"
  ON public.receipt_item_assignments
  FOR UPDATE
  TO authenticated
  USING (public.can_access_receipt(
    (SELECT ri.receipt_id FROM public.receipt_items ri WHERE ri.id = receipt_item_id)
  ))
  WITH CHECK (public.can_access_receipt(
    (SELECT ri.receipt_id FROM public.receipt_items ri WHERE ri.id = receipt_item_id)
  ));

CREATE POLICY "receipt_item_assignments_delete_members"
  ON public.receipt_item_assignments
  FOR DELETE
  TO authenticated
  USING (public.can_access_receipt(
    (SELECT ri.receipt_id FROM public.receipt_items ri WHERE ri.id = receipt_item_id)
  ));

-- Notifications: allow insert for other users (invite notifications)
DROP POLICY IF EXISTS "notifications_insert_own" ON public.notifications;

CREATE POLICY "notifications_insert_authenticated"
  ON public.notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Enable realtime for collaboration (ignore if already added)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.receipt_items;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.receipt_item_assignments;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.receipts;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.group_members;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
