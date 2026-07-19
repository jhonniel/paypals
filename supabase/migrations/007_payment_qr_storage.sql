-- Public bucket for payment QR codes (up to 3 per user under {user_id}/…)

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'payment-qr',
  'payment-qr',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "payment_qr_select_public"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'payment-qr');

CREATE POLICY "payment_qr_insert_own"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'payment-qr'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "payment_qr_update_own"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'payment-qr'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'payment-qr'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "payment_qr_delete_own"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'payment-qr'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
