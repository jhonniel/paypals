-- Nested receipt modifiers / add-ons under a main line item
ALTER TABLE public.receipt_items
  ADD COLUMN IF NOT EXISTS sub_items jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.receipt_items.sub_items IS
  'Array of { name: string, amount?: number } modifiers shown under the main item';
