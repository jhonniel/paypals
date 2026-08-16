-- Pal payment receipts are OCR-scanned only; drop stored-image columns if present.

ALTER TABLE public.pal_debt_payments
  DROP COLUMN IF EXISTS proof_storage_path,
  DROP COLUMN IF EXISTS proof_mime;
