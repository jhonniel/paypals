-- Per-item split target: who the cost is divided among.
-- among_claimers = whoever taps the item (default)
-- among_group    = every group member
-- among_n        = fixed N ways (owner sets split_n); claimers each pay total/N

ALTER TABLE public.receipt_items
  ADD COLUMN IF NOT EXISTS split_mode text NOT NULL DEFAULT 'among_n',
  ADD COLUMN IF NOT EXISTS split_n integer DEFAULT 1;

ALTER TABLE public.receipt_items
  DROP CONSTRAINT IF EXISTS receipt_items_split_mode_check;

ALTER TABLE public.receipt_items
  ADD CONSTRAINT receipt_items_split_mode_check
  CHECK (split_mode IN ('among_claimers', 'among_group', 'among_n'));

ALTER TABLE public.receipt_items
  DROP CONSTRAINT IF EXISTS receipt_items_split_n_check;

ALTER TABLE public.receipt_items
  ADD CONSTRAINT receipt_items_split_n_check
  CHECK (split_n IS NULL OR split_n >= 1);

COMMENT ON COLUMN public.receipt_items.split_mode IS
  'among_claimers | among_group | among_n — how this line is divided';
COMMENT ON COLUMN public.receipt_items.split_n IS
  'When split_mode = among_n, divide item total by this many shares';
