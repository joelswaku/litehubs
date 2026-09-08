-- Structured objectives are linked to the existing employee performance review.
CREATE TABLE performance_review_goals (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  review_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  target text,
  due_on date,
  weight numeric(5,2),
  progress numeric(5,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'not_started',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT performance_review_goals_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT performance_review_goals_review_fk
    FOREIGN KEY (organization_id, review_id)
    REFERENCES performance_reviews (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT performance_review_goals_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT performance_review_goals_weight_range CHECK (weight IS NULL OR (weight > 0 AND weight <= 100)),
  CONSTRAINT performance_review_goals_progress_range CHECK (progress >= 0 AND progress <= 100),
  CONSTRAINT performance_review_goals_status_check
    CHECK (status IN ('not_started', 'in_progress', 'achieved', 'cancelled'))
);

CREATE TRIGGER performance_review_goals_set_updated_at
  BEFORE UPDATE ON performance_review_goals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX performance_review_goals_review_idx
  ON performance_review_goals (organization_id, review_id, status, due_on);

SELECT enable_tenant_rls('performance_review_goals');

-- Employees may see and acknowledge only their own reviews. The API enforces
-- self scope, while managers retain the ability to manage reviews.
INSERT INTO role_preset_permissions (role_preset_code, permission_code)
VALUES ('employee', 'performance.read'), ('employee', 'performance.update')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('performance.read', 'performance.update')
WHERE r.code = 'employee' AND r.is_system = true
ON CONFLICT DO NOTHING;
