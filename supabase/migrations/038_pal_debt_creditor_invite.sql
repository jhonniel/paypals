-- Debtor-initiated "I owe" records with invite link for creditor to claim.

ALTER TABLE public.pal_debts
  ALTER COLUMN creditor_id DROP NOT NULL;

ALTER TABLE public.pal_debts
  ADD COLUMN IF NOT EXISTS pending_creditor_name text,
  ADD COLUMN IF NOT EXISTS pending_creditor_email text;

ALTER TABLE public.pal_debts
  DROP CONSTRAINT IF EXISTS pal_debts_debtor_or_pending;

ALTER TABLE public.pal_debts
  ADD CONSTRAINT pal_debts_participants_or_pending CHECK (
    (debtor_id IS NOT NULL AND creditor_id IS NOT NULL)
    OR (
      creditor_id IS NOT NULL
      AND debtor_id IS NULL
      AND pending_debtor_name IS NOT NULL
      AND char_length(trim(pending_debtor_name)) > 0
      AND invite_token IS NOT NULL
    )
    OR (
      debtor_id IS NOT NULL
      AND creditor_id IS NULL
      AND pending_creditor_name IS NOT NULL
      AND char_length(trim(pending_creditor_name)) > 0
      AND invite_token IS NOT NULL
    )
  );

ALTER TABLE public.pal_debts
  DROP CONSTRAINT IF EXISTS pal_debts_no_self;

ALTER TABLE public.pal_debts
  ADD CONSTRAINT pal_debts_no_self CHECK (
    debtor_id IS NULL
    OR creditor_id IS NULL
    OR creditor_id <> debtor_id
  );

CREATE POLICY "pal_debts_insert_debtor_pending"
  ON public.pal_debts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    debtor_id = auth.uid()
    AND creditor_id IS NULL
    AND pending_creditor_name IS NOT NULL
    AND invite_token IS NOT NULL
  );

CREATE POLICY "pal_debts_delete_debtor_pending"
  ON public.pal_debts
  FOR DELETE
  TO authenticated
  USING (
    debtor_id = auth.uid()
    AND creditor_id IS NULL
    AND invite_token IS NOT NULL
  );

-- Preview either invite kind (debtor claim or creditor claim)
CREATE OR REPLACE FUNCTION public.get_pal_debt_invite(p_token text)
RETURNS TABLE (
  debt_id uuid,
  invite_kind text,
  pending_name text,
  pending_email text,
  amount numeric,
  currency text,
  description text,
  counterparty_name text,
  claimed boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    d.id,
    CASE
      WHEN d.debtor_id IS NULL THEN 'debtor_claim'
      WHEN d.creditor_id IS NULL THEN 'creditor_claim'
      ELSE 'linked'
    END,
    COALESCE(d.pending_debtor_name, d.pending_creditor_name),
    COALESCE(d.pending_debtor_email, d.pending_creditor_email),
    d.amount,
    d.currency,
    d.description,
    CASE
      WHEN d.debtor_id IS NULL THEN
        COALESCE(
          NULLIF(trim(cp.full_name), ''),
          CASE WHEN cp.username IS NOT NULL THEN '@' || cp.username ELSE NULL END,
          'Someone'
        )
      ELSE
        COALESCE(
          NULLIF(trim(dp.full_name), ''),
          CASE WHEN dp.username IS NOT NULL THEN '@' || dp.username ELSE NULL END,
          'Someone'
        )
    END,
    (d.debtor_id IS NOT NULL AND d.creditor_id IS NOT NULL)
  FROM public.pal_debts d
  LEFT JOIN public.profiles cp ON cp.id = d.creditor_id
  LEFT JOIN public.profiles dp ON dp.id = d.debtor_id
  WHERE d.invite_token = trim(p_token)
    AND d.status <> 'cancelled'
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_pal_debt_invite(text) TO anon, authenticated;

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
  debtor uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT d.id, d.creditor_id, d.debtor_id
  INTO debt_id, creditor, debtor
  FROM public.pal_debts d
  WHERE d.invite_token = trim(p_token)
    AND d.status = 'open'
  LIMIT 1;

  IF debt_id IS NULL THEN
    RAISE EXCEPTION 'Invite not found or already claimed';
  END IF;

  IF debtor IS NULL THEN
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
  ELSIF creditor IS NULL THEN
    IF debtor = uid THEN
      RAISE EXCEPTION 'You cannot claim a debt you recorded for yourself';
    END IF;

    UPDATE public.pal_debts
    SET creditor_id = uid,
        invite_token = NULL,
        claimed_at = now(),
        pending_creditor_name = NULL,
        pending_creditor_email = NULL
    WHERE id = debt_id;

    PERFORM public.ensure_accepted_friendship(uid, debtor);
  ELSE
    RAISE EXCEPTION 'Invite not found or already claimed';
  END IF;

  UPDATE public.profiles
  SET invite_verified = true,
      updated_at = now()
  WHERE id = uid;

  RETURN debt_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_pal_debt_invite(text) TO authenticated;
