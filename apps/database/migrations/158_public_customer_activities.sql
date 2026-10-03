BEGIN;

-- Marketing activities are intentionally separate from job applications,
-- employee accounts and customer orders.  A public account can only see cards
-- explicitly published for its company, never internal LiteHubs data.
CREATE TABLE public_customer_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  summary text NOT NULL,
  body text,
  image_url text,
  button_label text,
  button_url text,
  audience text NOT NULL DEFAULT 'all'
    CHECK (audience IN ('all', 'invited')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  published_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT public_customer_activities_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT public_customer_activities_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT public_customer_activities_summary_not_blank CHECK (btrim(summary) <> '')
);
CREATE INDEX public_customer_activities_visible_idx
  ON public_customer_activities (organization_id, status, published_at DESC);
CREATE TRIGGER public_customer_activities_set_updated_at
  BEFORE UPDATE ON public_customer_activities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT enable_tenant_rls('public_customer_activities');

-- A private activity can be shared with individual addresses.  Sending is
-- recorded without exposing recipient details to other customers.
CREATE TABLE public_customer_activity_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  activity_id uuid NOT NULL,
  email citext NOT NULL,
  sent_at timestamptz,
  viewed_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT public_customer_activity_recipients_activity_fk
    FOREIGN KEY (organization_id, activity_id)
    REFERENCES public_customer_activities(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT public_customer_activity_recipients_unique
    UNIQUE (organization_id, activity_id, email)
);
CREATE INDEX public_customer_activity_recipients_lookup_idx
  ON public_customer_activity_recipients (organization_id, activity_id, email);
SELECT enable_tenant_rls('public_customer_activity_recipients');

COMMIT;
