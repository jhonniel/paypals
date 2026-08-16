-- Manual "Pal owes me" debt records between users.

CREATE TABLE public.pal_debts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creditor_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  debtor_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'PHP',
  description text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  CONSTRAINT pal_debts_no_self CHECK (creditor_id <> debtor_id)
);

CREATE INDEX idx_pal_debts_creditor_id ON public.pal_debts (creditor_id);
CREATE INDEX idx_pal_debts_debtor_id ON public.pal_debts (debtor_id);
CREATE INDEX idx_pal_debts_status ON public.pal_debts (status);

CREATE TRIGGER trg_pal_debts_updated_at
  BEFORE UPDATE ON public.pal_debts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.pal_debts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pal_debts_select_participants"
  ON public.pal_debts
  FOR SELECT
  TO authenticated
  USING (creditor_id = auth.uid() OR debtor_id = auth.uid());

CREATE POLICY "pal_debts_insert_creditor"
  ON public.pal_debts
  FOR INSERT
  TO authenticated
  WITH CHECK (creditor_id = auth.uid());

CREATE POLICY "pal_debts_update_creditor"
  ON public.pal_debts
  FOR UPDATE
  TO authenticated
  USING (creditor_id = auth.uid())
  WITH CHECK (creditor_id = auth.uid());

CREATE POLICY "pal_debts_delete_creditor"
  ON public.pal_debts
  FOR DELETE
  TO authenticated
  USING (creditor_id = auth.uid());
