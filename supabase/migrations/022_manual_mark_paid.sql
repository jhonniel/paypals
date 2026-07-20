-- Allow group owners/admins to insert payment proofs for any member
-- (manual "mark as paid").

CREATE POLICY "group_payment_proofs_insert_manager"
  ON public.group_payment_proofs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.group_id = group_payment_proofs.group_id
        AND gm.user_id = auth.uid()
        AND gm.role IN ('owner', 'admin')
    )
  );

CREATE POLICY "group_payment_proofs_delete_manager"
  ON public.group_payment_proofs
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.group_id = group_payment_proofs.group_id
        AND gm.user_id = auth.uid()
        AND gm.role IN ('owner', 'admin')
    )
  );
