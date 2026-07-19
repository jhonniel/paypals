-- Group payment proofs: member uploads e-wallet/bank screenshot after paying.
-- Validated amount must match their current Pays total; OCR date must be today.

CREATE TABLE IF NOT EXISTS public.group_payment_proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups (id) ON DELETE CASCADE,
  from_member_id uuid NOT NULL REFERENCES public.group_members (id) ON DELETE CASCADE,
  to_member_id uuid REFERENCES public.group_members (id) ON DELETE SET NULL,
  expected_amount numeric(12, 2) NOT NULL,
  ocr_amount numeric(12, 2),
  ocr_date date,
  currency text NOT NULL DEFAULT 'PHP',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'rejected')),
  proof_storage_path text,
  proof_mime text,
  rejection_reason text,
  ocr_raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  validated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT group_payment_proofs_expected_positive CHECK (expected_amount > 0),
  CONSTRAINT group_payment_proofs_one_per_member UNIQUE (group_id, from_member_id)
);

CREATE INDEX IF NOT EXISTS idx_group_payment_proofs_group_id
  ON public.group_payment_proofs (group_id);
CREATE INDEX IF NOT EXISTS idx_group_payment_proofs_from_member_id
  ON public.group_payment_proofs (from_member_id);
CREATE INDEX IF NOT EXISTS idx_group_payment_proofs_status
  ON public.group_payment_proofs (status);

CREATE TRIGGER trg_group_payment_proofs_updated_at
  BEFORE UPDATE ON public.group_payment_proofs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.group_payment_proofs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "group_payment_proofs_select_member"
  ON public.group_payment_proofs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.group_id = group_payment_proofs.group_id
        AND gm.user_id = auth.uid()
    )
  );

CREATE POLICY "group_payment_proofs_insert_own"
  ON public.group_payment_proofs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.id = group_payment_proofs.from_member_id
        AND gm.group_id = group_payment_proofs.group_id
        AND gm.user_id = auth.uid()
    )
  );

CREATE POLICY "group_payment_proofs_update_own_or_manager"
  ON public.group_payment_proofs
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.id = group_payment_proofs.from_member_id
        AND gm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.group_id = group_payment_proofs.group_id
        AND gm.user_id = auth.uid()
        AND gm.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.id = group_payment_proofs.from_member_id
        AND gm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.group_id = group_payment_proofs.group_id
        AND gm.user_id = auth.uid()
        AND gm.role IN ('owner', 'admin')
    )
  );

-- Private bucket for payment proof screenshots
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'payment-proofs',
  'payment-proofs',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "payment_proofs_select_own"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'payment-proofs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "payment_proofs_insert_own"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'payment-proofs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "payment_proofs_update_own"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'payment-proofs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'payment-proofs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "payment_proofs_delete_own"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'payment-proofs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
