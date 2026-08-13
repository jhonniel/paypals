-- Remove fully used signup invites after they have been idle for 7 days.

CREATE OR REPLACE FUNCTION public.cleanup_exhausted_signup_invites(
  p_older_than interval DEFAULT interval '7 days'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed integer;
BEGIN
  IF to_regprocedure('public.is_admin()') IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  DELETE FROM public.signup_invites
  WHERE use_count > 0
    AND max_uses IS NOT NULL
    AND use_count >= max_uses
    AND updated_at < now() - p_older_than;

  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_exhausted_signup_invites(interval) TO authenticated;
