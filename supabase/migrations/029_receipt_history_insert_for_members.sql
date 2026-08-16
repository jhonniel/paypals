-- Allow group owner/admin (or receipt creator) to insert receipt_history
-- on behalf of a seated group member (e.g. claims_confirmed join gate).

CREATE OR REPLACE FUNCTION public.can_insert_receipt_history(
  p_receipt_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.can_access_receipt(p_receipt_id)
    AND (
      p_user_id IS NULL
      OR p_user_id = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.receipts r
        INNER JOIN public.group_members target ON target.group_id = r.group_id
        WHERE r.id = p_receipt_id
          AND r.group_id IS NOT NULL
          AND target.user_id = p_user_id
          AND (
            public.is_group_admin(r.group_id)
            OR r.created_by = auth.uid()
          )
      )
    );
$$;

DROP POLICY IF EXISTS "receipt_history_insert_via_receipt" ON public.receipt_history;

CREATE POLICY "receipt_history_insert_via_receipt"
  ON public.receipt_history
  FOR INSERT
  TO authenticated
  WITH CHECK (public.can_insert_receipt_history(receipt_id, user_id));

GRANT EXECUTE ON FUNCTION public.can_insert_receipt_history(uuid, uuid) TO authenticated;
