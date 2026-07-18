-- =============================================================================
-- Paypals Phase 4 — Feature flags + account helpers
-- =============================================================================

-- Feature flags (admin-managed; readable by authenticated users)
CREATE TABLE IF NOT EXISTS public.feature_flags (
  key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  description text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feature_flags_enabled ON public.feature_flags (enabled);

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "feature_flags_select_authenticated" ON public.feature_flags;
CREATE POLICY "feature_flags_select_authenticated"
  ON public.feature_flags
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "feature_flags_insert_admins" ON public.feature_flags;
CREATE POLICY "feature_flags_insert_admins"
  ON public.feature_flags
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "feature_flags_update_admins" ON public.feature_flags;
CREATE POLICY "feature_flags_update_admins"
  ON public.feature_flags
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "feature_flags_delete_admins" ON public.feature_flags;
CREATE POLICY "feature_flags_delete_admins"
  ON public.feature_flags
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- Allow service/system inserts into audit_logs via SECURITY DEFINER helper
CREATE OR REPLACE FUNCTION public.write_audit_log(
  p_action text,
  p_entity_type text,
  p_entity_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id uuid;
BEGIN
  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), p_action, p_entity_type, p_entity_id, COALESCE(p_metadata, '{}'::jsonb))
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.write_audit_log(text, text, uuid, jsonb) TO authenticated;

-- Soft-delete / account export helper: count storage objects for a user path prefix
-- (used by app via storage API; no SQL needed)

-- Seed default flags
INSERT INTO public.feature_flags (key, enabled, description)
VALUES
  ('analytics_v1', true, 'User analytics dashboard'),
  ('admin_panel', true, 'Admin console for operators'),
  ('export_data', true, 'Allow users to export their data'),
  ('delete_account', true, 'Allow users to permanently delete their account'),
  ('ocr_provider_override', true, 'Let users pick OCR provider in settings')
ON CONFLICT (key) DO NOTHING;

-- Ensure casey demo admin stays admin if present
UPDATE public.profiles
SET is_admin = true
WHERE email = 'casey@example.com';
