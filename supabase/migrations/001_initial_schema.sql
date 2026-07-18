-- =============================================================================
-- Paypals — Initial Schema
-- Production-ready PostgreSQL schema for receipt splitter SaaS on Supabase
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Extensions
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- 2. Enums
-- -----------------------------------------------------------------------------
CREATE TYPE public.group_role AS ENUM ('owner', 'admin', 'member');
CREATE TYPE public.friendship_status AS ENUM ('pending', 'accepted', 'blocked');
CREATE TYPE public.receipt_status AS ENUM (
  'draft',
  'uploaded',
  'ocr_complete',
  'edited',
  'members_assigned',
  'finalized',
  'archived'
);
CREATE TYPE public.split_method AS ENUM (
  'equal',
  'percentage',
  'quantity',
  'custom',
  'weighted'
);
CREATE TYPE public.theme_preference AS ENUM ('light', 'dark', 'system');
CREATE TYPE public.notification_type AS ENUM (
  'invitation',
  'reminder',
  'receipt_updated',
  'member_joined',
  'split_completed',
  'payment_reminder'
);
CREATE TYPE public.payment_status AS ENUM ('pending', 'paid', 'cancelled');

-- -----------------------------------------------------------------------------
-- 3. Tables
-- -----------------------------------------------------------------------------

-- Profiles (1:1 with auth.users)
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text,
  username text UNIQUE,
  avatar_url text,
  bio text,
  is_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_email_check CHECK (email ~* '^[^@]+@[^@]+\.[^@]+$'),
  CONSTRAINT profiles_username_length CHECK (
    username IS NULL OR (char_length(username) >= 3 AND char_length(username) <= 30)
  )
);

-- User settings (1:1 with profiles)
CREATE TABLE public.user_settings (
  user_id uuid PRIMARY KEY REFERENCES public.profiles (id) ON DELETE CASCADE,
  theme public.theme_preference NOT NULL DEFAULT 'system',
  currency text NOT NULL DEFAULT 'PHP',
  timezone text NOT NULL DEFAULT 'UTC',
  language text NOT NULL DEFAULT 'en',
  ocr_provider text,
  notification_email boolean NOT NULL DEFAULT true,
  notification_push boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Friends / friendships
CREATE TABLE public.friends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  addressee_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  status public.friendship_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT friends_requester_addressee_unique UNIQUE (requester_id, addressee_id),
  CONSTRAINT friends_no_self CHECK (requester_id <> addressee_id)
);

-- Groups
CREATE TABLE public.groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  photo_url text,
  invite_code text UNIQUE NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
  created_by uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT groups_name_length CHECK (char_length(name) >= 1 AND char_length(name) <= 100)
);

-- Group members (supports registered users and guests)
CREATE TABLE public.group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups (id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles (id) ON DELETE CASCADE,
  role public.group_role NOT NULL DEFAULT 'member',
  guest_email text,
  guest_name text,
  invite_token text UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  claimed_at timestamptz,
  joined_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT group_members_user_or_guest CHECK (
    user_id IS NOT NULL OR (guest_email IS NOT NULL AND guest_name IS NOT NULL)
  ),
  CONSTRAINT group_members_group_user_unique UNIQUE (group_id, user_id),
  CONSTRAINT group_members_guest_email_check CHECK (
    guest_email IS NULL OR guest_email ~* '^[^@]+@[^@]+\.[^@]+$'
  )
);

-- Partial unique index: one guest email per group when user_id is null
CREATE UNIQUE INDEX group_members_group_guest_email_unique
  ON public.group_members (group_id, lower(guest_email))
  WHERE user_id IS NULL AND guest_email IS NOT NULL;

-- Receipts
CREATE TABLE public.receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid REFERENCES public.groups (id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  merchant text,
  receipt_date date,
  receipt_time time,
  currency text NOT NULL DEFAULT 'PHP',
  subtotal numeric(12, 2) NOT NULL DEFAULT 0,
  tax numeric(12, 2) NOT NULL DEFAULT 0,
  discount numeric(12, 2) NOT NULL DEFAULT 0,
  service_charge numeric(12, 2) NOT NULL DEFAULT 0,
  tip numeric(12, 2) NOT NULL DEFAULT 0,
  total numeric(12, 2) NOT NULL DEFAULT 0,
  status public.receipt_status NOT NULL DEFAULT 'draft',
  notes text,
  ocr_confidence numeric(5, 2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz,
  CONSTRAINT receipts_ocr_confidence_range CHECK (
    ocr_confidence IS NULL OR (ocr_confidence >= 0 AND ocr_confidence <= 100)
  ),
  CONSTRAINT receipts_amounts_non_negative CHECK (
    subtotal >= 0
    AND tax >= 0
    AND discount >= 0
    AND service_charge >= 0
    AND tip >= 0
    AND total >= 0
  )
);

-- Receipt images
CREATE TABLE public.receipt_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES public.receipts (id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  mime_type text,
  file_size bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT receipt_images_file_size_positive CHECK (
    file_size IS NULL OR file_size > 0
  )
);

-- Receipt line items
CREATE TABLE public.receipt_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES public.receipts (id) ON DELETE CASCADE,
  name text NOT NULL,
  quantity numeric(12, 3) NOT NULL DEFAULT 1,
  unit_price numeric(12, 2) NOT NULL DEFAULT 0,
  total_price numeric(12, 2) NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT receipt_items_quantity_positive CHECK (quantity > 0),
  CONSTRAINT receipt_items_prices_non_negative CHECK (
    unit_price >= 0 AND total_price >= 0
  )
);

-- Item assignments to group members
CREATE TABLE public.receipt_item_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_item_id uuid NOT NULL REFERENCES public.receipt_items (id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.group_members (id) ON DELETE CASCADE,
  split_method public.split_method NOT NULL DEFAULT 'equal',
  share_percentage numeric(5, 2),
  share_quantity numeric(12, 3),
  share_amount numeric(12, 2),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT receipt_item_assignments_unique UNIQUE (receipt_item_id, member_id),
  CONSTRAINT receipt_item_assignments_percentage_range CHECK (
    share_percentage IS NULL OR (share_percentage >= 0 AND share_percentage <= 100)
  ),
  CONSTRAINT receipt_item_assignments_quantity_non_negative CHECK (
    share_quantity IS NULL OR share_quantity >= 0
  ),
  CONSTRAINT receipt_item_assignments_amount_non_negative CHECK (
    share_amount IS NULL OR share_amount >= 0
  )
);

-- Receipt audit / event history
CREATE TABLE public.receipt_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES public.receipts (id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  event text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Notifications
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  type public.notification_type NOT NULL,
  title text NOT NULL,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Activity feed
CREATE TABLE public.activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  group_id uuid REFERENCES public.groups (id) ON DELETE CASCADE,
  receipt_id uuid REFERENCES public.receipts (id) ON DELETE CASCADE,
  action text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- OCR processing logs
CREATE TABLE public.ocr_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES public.receipts (id) ON DELETE CASCADE,
  provider text NOT NULL,
  status text NOT NULL,
  request_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric(5, 2),
  error_message text,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ocr_logs_confidence_range CHECK (
    confidence IS NULL OR (confidence >= 0 AND confidence <= 100)
  ),
  CONSTRAINT ocr_logs_duration_non_negative CHECK (
    duration_ms IS NULL OR duration_ms >= 0
  )
);

-- Payments between members
CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES public.receipts (id) ON DELETE CASCADE,
  from_member_id uuid NOT NULL REFERENCES public.group_members (id) ON DELETE RESTRICT,
  to_member_id uuid NOT NULL REFERENCES public.group_members (id) ON DELETE RESTRICT,
  amount numeric(12, 2) NOT NULL,
  currency text NOT NULL DEFAULT 'PHP',
  status public.payment_status NOT NULL DEFAULT 'pending',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payments_amount_positive CHECK (amount > 0),
  CONSTRAINT payments_different_members CHECK (from_member_id <> to_member_id)
);

-- System audit logs
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip inet,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 4. Indexes (FKs and common search columns)
-- -----------------------------------------------------------------------------

-- profiles
CREATE INDEX idx_profiles_email ON public.profiles (email);
CREATE INDEX idx_profiles_username ON public.profiles (username);
CREATE INDEX idx_profiles_full_name ON public.profiles (full_name);

-- friends
CREATE INDEX idx_friends_requester_id ON public.friends (requester_id);
CREATE INDEX idx_friends_addressee_id ON public.friends (addressee_id);
CREATE INDEX idx_friends_status ON public.friends (status);

-- groups
CREATE INDEX idx_groups_created_by ON public.groups (created_by);
CREATE INDEX idx_groups_invite_code ON public.groups (invite_code);
CREATE INDEX idx_groups_name ON public.groups (name);

-- group_members
CREATE INDEX idx_group_members_group_id ON public.group_members (group_id);
CREATE INDEX idx_group_members_user_id ON public.group_members (user_id);
CREATE INDEX idx_group_members_invite_token ON public.group_members (invite_token);
CREATE INDEX idx_group_members_guest_email ON public.group_members (guest_email);
CREATE INDEX idx_group_members_role ON public.group_members (role);

-- receipts
CREATE INDEX idx_receipts_group_id ON public.receipts (group_id);
CREATE INDEX idx_receipts_created_by ON public.receipts (created_by);
CREATE INDEX idx_receipts_merchant ON public.receipts (merchant);
CREATE INDEX idx_receipts_status ON public.receipts (status);
CREATE INDEX idx_receipts_receipt_date ON public.receipts (receipt_date);
CREATE INDEX idx_receipts_created_at ON public.receipts (created_at DESC);

-- receipt_images
CREATE INDEX idx_receipt_images_receipt_id ON public.receipt_images (receipt_id);

-- receipt_items
CREATE INDEX idx_receipt_items_receipt_id ON public.receipt_items (receipt_id);
CREATE INDEX idx_receipt_items_sort_order ON public.receipt_items (receipt_id, sort_order);

-- receipt_item_assignments
CREATE INDEX idx_receipt_item_assignments_receipt_item_id
  ON public.receipt_item_assignments (receipt_item_id);
CREATE INDEX idx_receipt_item_assignments_member_id
  ON public.receipt_item_assignments (member_id);
CREATE INDEX idx_receipt_item_assignments_split_method
  ON public.receipt_item_assignments (split_method);

-- receipt_history
CREATE INDEX idx_receipt_history_receipt_id ON public.receipt_history (receipt_id);
CREATE INDEX idx_receipt_history_user_id ON public.receipt_history (user_id);
CREATE INDEX idx_receipt_history_created_at ON public.receipt_history (created_at DESC);

-- notifications
CREATE INDEX idx_notifications_user_id ON public.notifications (user_id);
CREATE INDEX idx_notifications_type ON public.notifications (type);
CREATE INDEX idx_notifications_created_at ON public.notifications (created_at DESC);
CREATE INDEX idx_notifications_unread
  ON public.notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

-- activities
CREATE INDEX idx_activities_user_id ON public.activities (user_id);
CREATE INDEX idx_activities_group_id ON public.activities (group_id);
CREATE INDEX idx_activities_receipt_id ON public.activities (receipt_id);
CREATE INDEX idx_activities_created_at ON public.activities (created_at DESC);

-- ocr_logs
CREATE INDEX idx_ocr_logs_receipt_id ON public.ocr_logs (receipt_id);
CREATE INDEX idx_ocr_logs_status ON public.ocr_logs (status);
CREATE INDEX idx_ocr_logs_provider ON public.ocr_logs (provider);
CREATE INDEX idx_ocr_logs_created_at ON public.ocr_logs (created_at DESC);

-- payments
CREATE INDEX idx_payments_receipt_id ON public.payments (receipt_id);
CREATE INDEX idx_payments_from_member_id ON public.payments (from_member_id);
CREATE INDEX idx_payments_to_member_id ON public.payments (to_member_id);
CREATE INDEX idx_payments_status ON public.payments (status);

-- audit_logs
CREATE INDEX idx_audit_logs_actor_id ON public.audit_logs (actor_id);
CREATE INDEX idx_audit_logs_entity ON public.audit_logs (entity_type, entity_id);
CREATE INDEX idx_audit_logs_created_at ON public.audit_logs (created_at DESC);
CREATE INDEX idx_audit_logs_action ON public.audit_logs (action);

-- -----------------------------------------------------------------------------
-- 5. updated_at trigger
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_user_settings_updated_at
  BEFORE UPDATE ON public.user_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_friends_updated_at
  BEFORE UPDATE ON public.friends
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_groups_updated_at
  BEFORE UPDATE ON public.groups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_receipts_updated_at
  BEFORE UPDATE ON public.receipts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_receipt_items_updated_at
  BEFORE UPDATE ON public.receipt_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_payments_updated_at
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 6. handle_new_user — create profile + settings on signup
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(
      NEW.raw_user_meta_data ->> 'full_name',
      NEW.raw_user_meta_data ->> 'name',
      NULL
    ),
    COALESCE(
      NEW.raw_user_meta_data ->> 'avatar_url',
      NEW.raw_user_meta_data ->> 'picture',
      NULL
    )
  );

  INSERT INTO public.user_settings (user_id)
  VALUES (NEW.id);

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- -----------------------------------------------------------------------------
-- 8. RLS helper functions (security definer, locked search_path)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.is_admin = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_group_member(p_group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.group_members gm
    WHERE gm.group_id = p_group_id
      AND gm.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_group_admin(p_group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.group_members gm
    WHERE gm.group_id = p_group_id
      AND gm.user_id = auth.uid()
      AND gm.role IN ('owner', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_receipt(p_receipt_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.receipts r
    WHERE r.id = p_receipt_id
      AND (
        r.created_by = auth.uid()
        OR (r.group_id IS NOT NULL AND public.is_group_member(r.group_id))
        OR public.is_admin()
      )
  );
$$;

-- -----------------------------------------------------------------------------
-- 7. Enable RLS on all tables
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friends ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_item_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ocr_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 8. RLS Policies
-- -----------------------------------------------------------------------------

-- profiles: read all (friends search), update own
CREATE POLICY "profiles_select_authenticated"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "profiles_update_own"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- user_settings: own only
CREATE POLICY "user_settings_select_own"
  ON public.user_settings
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "user_settings_insert_own"
  ON public.user_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_settings_update_own"
  ON public.user_settings
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_settings_delete_own"
  ON public.user_settings
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- friends: participants can read/write their friendships
CREATE POLICY "friends_select_participants"
  ON public.friends
  FOR SELECT
  TO authenticated
  USING (
    requester_id = auth.uid()
    OR addressee_id = auth.uid()
  );

CREATE POLICY "friends_insert_as_requester"
  ON public.friends
  FOR INSERT
  TO authenticated
  WITH CHECK (requester_id = auth.uid());

CREATE POLICY "friends_update_participants"
  ON public.friends
  FOR UPDATE
  TO authenticated
  USING (
    requester_id = auth.uid()
    OR addressee_id = auth.uid()
  )
  WITH CHECK (
    requester_id = auth.uid()
    OR addressee_id = auth.uid()
  );

CREATE POLICY "friends_delete_participants"
  ON public.friends
  FOR DELETE
  TO authenticated
  USING (
    requester_id = auth.uid()
    OR addressee_id = auth.uid()
  );

-- groups: members select; creator insert; owner/admin update; owner delete
CREATE POLICY "groups_select_members"
  ON public.groups
  FOR SELECT
  TO authenticated
  USING (
    public.is_group_member(id)
    OR created_by = auth.uid()
    OR public.is_admin()
  );

CREATE POLICY "groups_insert_authenticated"
  ON public.groups
  FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "groups_update_admins"
  ON public.groups
  FOR UPDATE
  TO authenticated
  USING (public.is_group_admin(id) OR public.is_admin())
  WITH CHECK (public.is_group_admin(id) OR public.is_admin());

CREATE POLICY "groups_delete_owner"
  ON public.groups
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.group_members gm
      WHERE gm.group_id = groups.id
        AND gm.user_id = auth.uid()
        AND gm.role = 'owner'
    )
    OR public.is_admin()
  );

-- group_members: same-group select; owner/admin manage; self-join via invite
CREATE POLICY "group_members_select_same_group"
  ON public.group_members
  FOR SELECT
  TO authenticated
  USING (
    public.is_group_member(group_id)
    OR user_id = auth.uid()
    OR public.is_admin()
  );

CREATE POLICY "group_members_insert_admin_or_self"
  ON public.group_members
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_group_admin(group_id)
    OR user_id = auth.uid()
    OR public.is_admin()
  );

CREATE POLICY "group_members_update_admins"
  ON public.group_members
  FOR UPDATE
  TO authenticated
  USING (public.is_group_admin(group_id) OR public.is_admin())
  WITH CHECK (public.is_group_admin(group_id) OR public.is_admin());

CREATE POLICY "group_members_delete_admins_or_self"
  ON public.group_members
  FOR DELETE
  TO authenticated
  USING (
    public.is_group_admin(group_id)
    OR user_id = auth.uid()
    OR public.is_admin()
  );

-- receipts: creator or group members select; creator insert/update/delete
CREATE POLICY "receipts_select_creator_or_members"
  ON public.receipts
  FOR SELECT
  TO authenticated
  USING (
    created_by = auth.uid()
    OR (group_id IS NOT NULL AND public.is_group_member(group_id))
    OR public.is_admin()
  );

CREATE POLICY "receipts_insert_creator"
  ON public.receipts
  FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "receipts_update_creator"
  ON public.receipts
  FOR UPDATE
  TO authenticated
  USING (created_by = auth.uid() OR public.is_admin())
  WITH CHECK (created_by = auth.uid() OR public.is_admin());

CREATE POLICY "receipts_delete_creator"
  ON public.receipts
  FOR DELETE
  TO authenticated
  USING (created_by = auth.uid() OR public.is_admin());

-- receipt_images: via receipt visibility
CREATE POLICY "receipt_images_select_via_receipt"
  ON public.receipt_images
  FOR SELECT
  TO authenticated
  USING (public.can_access_receipt(receipt_id));

CREATE POLICY "receipt_images_insert_via_receipt"
  ON public.receipt_images
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.receipts r
      WHERE r.id = receipt_id AND r.created_by = auth.uid()
    )
  );

CREATE POLICY "receipt_images_update_via_receipt"
  ON public.receipt_images
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.receipts r
      WHERE r.id = receipt_id AND r.created_by = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.receipts r
      WHERE r.id = receipt_id AND r.created_by = auth.uid()
    )
  );

CREATE POLICY "receipt_images_delete_via_receipt"
  ON public.receipt_images
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.receipts r
      WHERE r.id = receipt_id AND r.created_by = auth.uid()
    )
  );

-- receipt_items: via receipt visibility
CREATE POLICY "receipt_items_select_via_receipt"
  ON public.receipt_items
  FOR SELECT
  TO authenticated
  USING (public.can_access_receipt(receipt_id));

CREATE POLICY "receipt_items_insert_via_receipt"
  ON public.receipt_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.receipts r
      WHERE r.id = receipt_id AND r.created_by = auth.uid()
    )
  );

CREATE POLICY "receipt_items_update_via_receipt"
  ON public.receipt_items
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.receipts r
      WHERE r.id = receipt_id AND r.created_by = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.receipts r
      WHERE r.id = receipt_id AND r.created_by = auth.uid()
    )
  );

CREATE POLICY "receipt_items_delete_via_receipt"
  ON public.receipt_items
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.receipts r
      WHERE r.id = receipt_id AND r.created_by = auth.uid()
    )
  );

-- receipt_item_assignments: via receipt visibility
CREATE POLICY "receipt_item_assignments_select_via_receipt"
  ON public.receipt_item_assignments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.receipt_items ri
      WHERE ri.id = receipt_item_id
        AND public.can_access_receipt(ri.receipt_id)
    )
  );

CREATE POLICY "receipt_item_assignments_insert_via_receipt"
  ON public.receipt_item_assignments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.receipt_items ri
      JOIN public.receipts r ON r.id = ri.receipt_id
      WHERE ri.id = receipt_item_id
        AND r.created_by = auth.uid()
    )
  );

CREATE POLICY "receipt_item_assignments_update_via_receipt"
  ON public.receipt_item_assignments
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.receipt_items ri
      JOIN public.receipts r ON r.id = ri.receipt_id
      WHERE ri.id = receipt_item_id
        AND r.created_by = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.receipt_items ri
      JOIN public.receipts r ON r.id = ri.receipt_id
      WHERE ri.id = receipt_item_id
        AND r.created_by = auth.uid()
    )
  );

CREATE POLICY "receipt_item_assignments_delete_via_receipt"
  ON public.receipt_item_assignments
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.receipt_items ri
      JOIN public.receipts r ON r.id = ri.receipt_id
      WHERE ri.id = receipt_item_id
        AND r.created_by = auth.uid()
    )
  );

-- receipt_history: via receipt visibility
CREATE POLICY "receipt_history_select_via_receipt"
  ON public.receipt_history
  FOR SELECT
  TO authenticated
  USING (public.can_access_receipt(receipt_id));

CREATE POLICY "receipt_history_insert_via_receipt"
  ON public.receipt_history
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.can_access_receipt(receipt_id)
    AND (user_id IS NULL OR user_id = auth.uid())
  );

-- notifications: own only
CREATE POLICY "notifications_select_own"
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "notifications_insert_own"
  ON public.notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "notifications_update_own"
  ON public.notifications
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "notifications_delete_own"
  ON public.notifications
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- activities: own or group members
CREATE POLICY "activities_select_own_or_group"
  ON public.activities
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR (group_id IS NOT NULL AND public.is_group_member(group_id))
    OR (receipt_id IS NOT NULL AND public.can_access_receipt(receipt_id))
    OR public.is_admin()
  );

CREATE POLICY "activities_insert_authenticated"
  ON public.activities
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR public.is_admin()
  );

-- ocr_logs: receipt creator or admin
CREATE POLICY "ocr_logs_select_creator_or_admin"
  ON public.ocr_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.receipts r
      WHERE r.id = receipt_id
        AND (r.created_by = auth.uid() OR public.is_admin())
    )
  );

CREATE POLICY "ocr_logs_insert_creator_or_admin"
  ON public.ocr_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.receipts r
      WHERE r.id = receipt_id
        AND (r.created_by = auth.uid() OR public.is_admin())
    )
  );

-- payments: involved members or receipt creator
CREATE POLICY "payments_select_involved_or_creator"
  ON public.payments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.receipts r
      WHERE r.id = receipt_id AND r.created_by = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.id IN (from_member_id, to_member_id)
        AND gm.user_id = auth.uid()
    )
    OR public.is_admin()
  );

CREATE POLICY "payments_insert_involved_or_creator"
  ON public.payments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.receipts r
      WHERE r.id = receipt_id AND r.created_by = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.id IN (from_member_id, to_member_id)
        AND gm.user_id = auth.uid()
    )
    OR public.is_admin()
  );

CREATE POLICY "payments_update_involved_or_creator"
  ON public.payments
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.receipts r
      WHERE r.id = receipt_id AND r.created_by = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.id IN (from_member_id, to_member_id)
        AND gm.user_id = auth.uid()
    )
    OR public.is_admin()
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.receipts r
      WHERE r.id = receipt_id AND r.created_by = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.id IN (from_member_id, to_member_id)
        AND gm.user_id = auth.uid()
    )
    OR public.is_admin()
  );

CREATE POLICY "payments_delete_creator_or_admin"
  ON public.payments
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.receipts r
      WHERE r.id = receipt_id AND r.created_by = auth.uid()
    )
    OR public.is_admin()
  );

-- audit_logs: admins only
CREATE POLICY "audit_logs_select_admins"
  ON public.audit_logs
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "audit_logs_insert_admins"
  ON public.audit_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

-- -----------------------------------------------------------------------------
-- Grants for helper functions
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_group_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_group_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_receipt(uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- 9. Storage buckets and policies
-- -----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  (
    'avatars',
    'avatars',
    true,
    5242880,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  ),
  (
    'receipts',
    'receipts',
    false,
    20971520,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
  ),
  (
    'ocr-json',
    'ocr-json',
    false,
    5242880,
    ARRAY['application/json', 'text/plain']
  )
ON CONFLICT (id) DO NOTHING;

-- Avatars: authenticated users manage their own path {user_id}/**
CREATE POLICY "avatars_select_public"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'avatars');

CREATE POLICY "avatars_insert_own"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "avatars_update_own"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "avatars_delete_own"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Receipts bucket: authenticated upload/read for own folder {user_id}/**
CREATE POLICY "receipts_storage_select_own"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'receipts'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "receipts_storage_insert_own"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'receipts'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "receipts_storage_update_own"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'receipts'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'receipts'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "receipts_storage_delete_own"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'receipts'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- OCR JSON bucket: authenticated manage own folder {user_id}/**
CREATE POLICY "ocr_json_select_own"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'ocr-json'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "ocr_json_insert_own"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'ocr-json'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "ocr_json_update_own"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'ocr-json'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'ocr-json'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "ocr_json_delete_own"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'ocr-json'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
