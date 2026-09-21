-- Record received/paid on manual (no-account) pal debts before claim.

ALTER TABLE public.pal_debt_payments
  ALTER COLUMN creditor_id DROP NOT NULL,
  ALTER COLUMN debtor_id DROP NOT NULL;

ALTER TABLE public.pal_debt_payments
  ADD COLUMN IF NOT EXISTS pending_party_key text;

ALTER TABLE public.pal_debt_payments
  DROP CONSTRAINT IF EXISTS pal_debt_payments_no_self;

ALTER TABLE public.pal_debt_payments
  ADD CONSTRAINT pal_debt_payments_no_self CHECK (
    creditor_id IS NULL
    OR debtor_id IS NULL
    OR creditor_id <> debtor_id
  );

ALTER TABLE public.pal_debt_payments
  DROP CONSTRAINT IF EXISTS pal_debt_payments_participant;

ALTER TABLE public.pal_debt_payments
  ADD CONSTRAINT pal_debt_payments_participant CHECK (
    (creditor_id IS NOT NULL AND debtor_id IS NOT NULL)
    OR (
      pending_party_key IS NOT NULL
      AND char_length(trim(pending_party_key)) > 0
      AND (
        (creditor_id IS NOT NULL AND debtor_id IS NULL)
        OR (debtor_id IS NOT NULL AND creditor_id IS NULL)
      )
    )
  );

CREATE INDEX IF NOT EXISTS idx_pal_debt_payments_pending_party_key
  ON public.pal_debt_payments (pending_party_key)
  WHERE pending_party_key IS NOT NULL;

DROP POLICY IF EXISTS "pal_debts_update_debtor" ON public.pal_debts;
CREATE POLICY "pal_debts_update_debtor"
  ON public.pal_debts
  FOR UPDATE
  TO authenticated
  USING (debtor_id = auth.uid())
  WITH CHECK (debtor_id = auth.uid());
