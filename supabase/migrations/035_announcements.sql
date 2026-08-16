-- Admin announcements: global modal on publish, full article via notification bell

ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'announcement';

CREATE TABLE public.announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  summary text,
  body text NOT NULL,
  created_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  is_published boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_announcements_published ON public.announcements (is_published, published_at DESC);

CREATE TRIGGER trg_announcements_updated_at
  BEFORE UPDATE ON public.announcements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.announcement_dismissals (
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  announcement_id uuid NOT NULL REFERENCES public.announcements (id) ON DELETE CASCADE,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, announcement_id)
);

CREATE INDEX idx_announcement_dismissals_user ON public.announcement_dismissals (user_id);

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcement_dismissals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "announcements_select_published"
  ON public.announcements
  FOR SELECT
  TO authenticated
  USING (is_published = true OR public.is_admin());

CREATE POLICY "announcements_insert_admin"
  ON public.announcements
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "announcements_update_admin"
  ON public.announcements
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "announcements_delete_admin"
  ON public.announcements
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "announcement_dismissals_select_own"
  ON public.announcement_dismissals
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "announcement_dismissals_insert_own"
  ON public.announcement_dismissals
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());
