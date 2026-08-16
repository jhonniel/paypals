-- Link pal debts created from group member balances.

ALTER TABLE public.pal_debts
  ADD COLUMN IF NOT EXISTS source_group_id uuid REFERENCES public.groups (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_member_id uuid REFERENCES public.group_members (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pal_debts_source_group ON public.pal_debts (source_group_id)
  WHERE source_group_id IS NOT NULL;
