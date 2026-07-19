-- Owner can share the full members breakdown with the group (default: private)

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS members_visible_to_group boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.groups.members_visible_to_group IS
  'When true, all members see everyone''s pays/items. When false, each member only sees their own tile.';

NOTIFY pgrst, 'reload schema';
