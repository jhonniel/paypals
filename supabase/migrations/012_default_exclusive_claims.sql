-- Default: one person claims → item is taken/hidden.
-- Owner can switch items to among_claimers / among_n>1 / among_group to share.

ALTER TABLE public.receipt_items
  ALTER COLUMN split_mode SET DEFAULT 'among_n';

UPDATE public.receipt_items
SET
  split_mode = 'among_n',
  split_n = 1
WHERE split_mode = 'among_claimers'
  AND (split_n IS NULL OR split_n = 1);

UPDATE public.receipt_items
SET split_n = 1
WHERE split_mode = 'among_n'
  AND split_n IS NULL;
