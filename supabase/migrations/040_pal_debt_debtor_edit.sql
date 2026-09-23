-- Debtors can remove/edit their I owe records; both sides can edit/delete their payments.

DROP POLICY IF EXISTS "pal_debts_delete_debtor_pending" ON public.pal_debts;
DROP POLICY IF EXISTS "pal_debts_delete_debtor" ON public.pal_debts;
CREATE POLICY "pal_debts_delete_debtor"
  ON public.pal_debts
  FOR DELETE
  TO authenticated
  USING (debtor_id = auth.uid());

DROP POLICY IF EXISTS "pal_debt_payments_delete_debtor" ON public.pal_debt_payments;
CREATE POLICY "pal_debt_payments_delete_debtor"
  ON public.pal_debt_payments
  FOR DELETE
  TO authenticated
  USING (debtor_id = auth.uid());

DROP POLICY IF EXISTS "pal_debt_payments_update_creditor" ON public.pal_debt_payments;
CREATE POLICY "pal_debt_payments_update_creditor"
  ON public.pal_debt_payments
  FOR UPDATE
  TO authenticated
  USING (creditor_id = auth.uid())
  WITH CHECK (creditor_id = auth.uid());

DROP POLICY IF EXISTS "pal_debt_payments_update_debtor" ON public.pal_debt_payments;
CREATE POLICY "pal_debt_payments_update_debtor"
  ON public.pal_debt_payments
  FOR UPDATE
  TO authenticated
  USING (debtor_id = auth.uid())
  WITH CHECK (debtor_id = auth.uid());
