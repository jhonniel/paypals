-- Where friends should send money when settling a split.
-- payment_methods: up to 3 accounts
-- [{ "id", "type", "bank_name", "account_name", "account_number", "qr_code_url" }]

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS payment_methods jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS settlement_note text;

COMMENT ON COLUMN public.profiles.payment_methods IS
  'Up to 3 receiving accounts (bank/wallet name, account name, number, QR URL) shown when this user paid a bill.';

COMMENT ON COLUMN public.receipts.settlement_note IS
  'Optional one-off pay instructions for this receipt (overrides / supplements profile methods).';
