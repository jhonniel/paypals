-- Record Pal owes me debts for people without accounts; claim via invite link.

ALTER TABLE public.pal_debts
  ALTER COLUMN debtor_id DROP NOT NULL;

ALTER TABLE public.pal_debts
  DROP CONSTRAINT IF EXISTS pal_debts_no_self;

ALTER TABLE public.pal_debts
  ADD CONSTRAINT pal_debts_no_self CHECK (
    debtor_id IS NULL OR creditor_id <> debtor_id
  );

ALTER TABLE public.pal_debts
  ADD COLUMN IF NOT EXISTS pending_debtor_name text,
  ADD COLUMN IF NOT EXISTS pending_debtor_email text,
  ADD COLUMN IF NOT EXISTS invite_token text,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pal_debts_invite_token
  ON public.pal_debts (invite_token)
  WHERE invite_token IS NOT NULL;

ALTER TABLE public.pal_debts
  DROP CONSTRAINT IF EXISTS pal_debts_debtor_or_pending;

ALTER TABLE public.pal_debts
  ADD CONSTRAINT pal_debts_debtor_or_pending CHECK (
    debtor_id IS NOT NULL
    OR (
      pending_debtor_name IS NOT NULL
      AND char_length(trim(pending_debtor_name)) > 0
      AND invite_token IS NOT NULL
    )
  );

-- Preview a pal-debt invite (anon or authenticated)
CREATE OR REPLACE FUNCTION public.get_pal_debt_invite(p_token text)
RETURNS TABLE (
  debt_id uuid,
  pending_name text,
  pending_email text,
  amount numeric,
  currency text,
  description text,
  creditor_name text,
  claimed boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    d.id,
    d.pending_debtor_name,
    d.pending_debtor_email,
    d.amount,
    d.currency,
    d.description,
    COALESCE(
      NULLIF(trim(p.full_name), ''),
      CASE WHEN p.username IS NOT NULL THEN '@' || p.username ELSE NULL END,
      'Someone'
    ),
    (d.debtor_id IS NOT NULL OR d.claimed_at IS NOT NULL)
  FROM public.pal_debts d
  JOIN public.profiles p ON p.id = d.creditor_id
  WHERE d.invite_token = trim(p_token)
    AND d.status <> 'cancelled'
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_pal_debt_invite(text) TO anon, authenticated;

-- Claim pal debt after signup / login
CREATE OR REPLACE FUNCTION public.claim_pal_debt_invite(p_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  debt_id uuid;
  creditor uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT d.id, d.creditor_id INTO debt_id, creditor
  FROM public.pal_debts d
  WHERE d.invite_token = trim(p_token)
    AND d.debtor_id IS NULL
    AND d.status = 'open'
  LIMIT 1;

  IF debt_id IS NULL THEN
    RAISE EXCEPTION 'Invite not found or already claimed';
  END IF;

  IF creditor = uid THEN
    RAISE EXCEPTION 'You cannot claim a debt you recorded for yourself';
  END IF;

  UPDATE public.pal_debts
  SET debtor_id = uid,
      invite_token = NULL,
      claimed_at = now(),
      pending_debtor_name = NULL,
      pending_debtor_email = NULL
  WHERE id = debt_id;

  PERFORM public.ensure_accepted_friendship(creditor, uid);

  UPDATE public.profiles
  SET invite_verified = true,
      updated_at = now()
  WHERE id = uid;

  RETURN debt_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_pal_debt_invite(text) TO authenticated;
