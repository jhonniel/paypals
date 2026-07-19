-- Allow app admins to update other profiles (e.g. grant/revoke is_admin).
-- Without this, PATCH /api/admin appears to succeed but RLS blocks the write.

DO $$
BEGIN
  IF to_regprocedure('public.is_admin()') IS NULL THEN
    RAISE NOTICE 'Skipping profiles_update_admins — public.is_admin() not found';
    RETURN;
  END IF;

  DROP POLICY IF EXISTS "profiles_update_admins" ON public.profiles;
  CREATE POLICY "profiles_update_admins"
    ON public.profiles
    FOR UPDATE
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());
END $$;
