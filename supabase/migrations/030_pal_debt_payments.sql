-- Partial / manual received payments against pal debts.

ALTER TABLE public.pal_debts
  ADD COLUMN IF NOT EXISTS amount_received numeric(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.pal_debts
  DROP CONSTRAINT IF EXISTS pal_debts_amount_received_check;

ALTER TABLE public.pal_debts
  ADD CONSTRAINT pal_debts_amount_received_check
  CHECK (amount_received >= 0 AND amount_received <= amount);

CREATE TABLE IF NOT EXISTS public.pal_debt_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creditor_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  debtor_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'PHP',
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pal_debt_payments_no_self CHECK (creditor_id <> debtor_id)
);

CREATE INDEX IF NOT EXISTS idx_pal_debt_payments_creditor_id
  ON public.pal_debt_payments (creditor_id);
CREATE INDEX IF NOT EXISTS idx_pal_debt_payments_debtor_id
  ON public.pal_debt_payments (debtor_id);
CREATE INDEX IF NOT EXISTS idx_pal_debt_payments_created_at
  ON public.pal_debt_payments (created_at DESC);

ALTER TABLE public.pal_debt_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pal_debt_payments_select_participants"
  ON public.pal_debt_payments
  FOR SELECT
  TO authenticated
  USING (creditor_id = auth.uid() OR debtor_id = auth.uid());

CREATE POLICY "pal_debt_payments_insert_creditor"
  ON public.pal_debt_payments
  FOR INSERT
  TO authenticated
  WITH CHECK (creditor_id = auth.uid());

CREATE POLICY "pal_debt_payments_delete_creditor"
  ON public.pal_debt_payments
  FOR DELETE
  TO authenticated
  USING (creditor_id = auth.uid());
