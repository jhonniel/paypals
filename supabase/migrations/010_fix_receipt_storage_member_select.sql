-- Fix group-member receipt image access.
-- Unqualified `name` in EXISTS can mis-resolve; qualify as storage.objects.name.
-- Also covers installs that never applied 008.

DROP POLICY IF EXISTS "receipts_storage_select_via_receipt_access" ON storage.objects;

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
