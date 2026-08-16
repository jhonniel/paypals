-- Debtors can record payments they made (I owe → Paid flow).

CREATE POLICY "pal_debt_payments_insert_debtor"
  ON public.pal_debt_payments
  FOR INSERT
  TO authenticated
  WITH CHECK (debtor_id = auth.uid());
