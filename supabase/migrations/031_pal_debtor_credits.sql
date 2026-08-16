-- Overpayment credit per pal (creditor/debtor pair). Applied to future lent records.

CREATE TABLE IF NOT EXISTS public.pal_debtor_credits (
  creditor_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  debtor_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  credit_balance numeric(12, 2) NOT NULL DEFAULT 0 CHECK (credit_balance >= 0),
  currency text NOT NULL DEFAULT 'PHP',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (creditor_id, debtor_id),
  CONSTRAINT pal_debtor_credits_no_self CHECK (creditor_id <> debtor_id)
);

CREATE INDEX IF NOT EXISTS idx_pal_debtor_credits_creditor_id
  ON public.pal_debtor_credits (creditor_id);

ALTER TABLE public.pal_debtor_credits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pal_debtor_credits_select_participants"
  ON public.pal_debtor_credits
  FOR SELECT
  TO authenticated
  USING (creditor_id = auth.uid() OR debtor_id = auth.uid());

CREATE POLICY "pal_debtor_credits_insert_creditor"
  ON public.pal_debtor_credits
  FOR INSERT
  TO authenticated
  WITH CHECK (creditor_id = auth.uid());

CREATE POLICY "pal_debtor_credits_update_creditor"
  ON public.pal_debtor_credits
  FOR UPDATE
  TO authenticated
  USING (creditor_id = auth.uid())
  WITH CHECK (creditor_id = auth.uid());

CREATE POLICY "pal_debtor_credits_delete_creditor"
  ON public.pal_debtor_credits
  FOR DELETE
  TO authenticated
  USING (creditor_id = auth.uid());
