-- Multiple named discounts per receipt (label + amount).
-- receipts.discount remains the summed total for splits and legacy callers.

CREATE TABLE public.receipt_discounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES public.receipts (id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT 'Discount',
  amount numeric(12, 2) NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT receipt_discounts_amount_non_negative CHECK (amount >= 0),
  CONSTRAINT receipt_discounts_label_not_blank CHECK (char_length(trim(label)) > 0)
);

CREATE INDEX idx_receipt_discounts_receipt_id ON public.receipt_discounts (receipt_id);
CREATE INDEX idx_receipt_discounts_sort_order ON public.receipt_discounts (receipt_id, sort_order);

CREATE TRIGGER trg_receipt_discounts_updated_at
  BEFORE UPDATE ON public.receipt_discounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.receipt_discounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "receipt_discounts_select_via_receipt"
  ON public.receipt_discounts
  FOR SELECT
  TO authenticated
  USING (public.can_access_receipt(receipt_id));

CREATE POLICY "receipt_discounts_insert_via_receipt"
  ON public.receipt_discounts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.receipts r
      WHERE r.id = receipt_id AND r.created_by = auth.uid()
    )
  );

CREATE POLICY "receipt_discounts_update_via_receipt"
  ON public.receipt_discounts
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.receipts r
      WHERE r.id = receipt_id AND r.created_by = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.receipts r
      WHERE r.id = receipt_id AND r.created_by = auth.uid()
    )
  );

CREATE POLICY "receipt_discounts_delete_via_receipt"
  ON public.receipt_discounts
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.receipts r
      WHERE r.id = receipt_id AND r.created_by = auth.uid()
    )
  );

NOTIFY pgrst, 'reload schema';
