-- Allow group members (and creators) to read receipt image objects in storage
-- when they can access the linked receipt.

CREATE POLICY "receipts_storage_select_via_receipt_access"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'receipts'
    AND EXISTS (
      SELECT 1
      FROM public.receipt_images ri
      WHERE ri.storage_path = storage.objects.name
        AND public.can_access_receipt(ri.receipt_id)
    )
  );
