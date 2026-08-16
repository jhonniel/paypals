-- OCR scan metadata on pal received payments (image is not stored).

ALTER TABLE public.pal_debt_payments
  ADD COLUMN IF NOT EXISTS transaction_number text,
  ADD COLUMN IF NOT EXISTS ocr_amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS ocr_raw jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_pal_debt_payments_transaction_number
  ON public.pal_debt_payments (transaction_number)
  WHERE transaction_number IS NOT NULL;
