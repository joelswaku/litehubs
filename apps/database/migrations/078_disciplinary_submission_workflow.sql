-- A disciplinary report has two distinct controls: authorized HR/performance staff
-- submit it for review, while only the owner or General Manager makes the final decision.
BEGIN;

ALTER TABLE disciplinary_actions
  ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz;

INSERT INTO permissions (code, resource, action, module_code, description)
VALUES (
  'disciplinary_actions.submit',
  'disciplinary_actions',
  'submit',
  'hr',
  'Submit a documented disciplinary case for owner or General Manager decision'
)
ON CONFLICT (code) DO UPDATE
  SET description = EXCLUDED.description;

-- HR officers can submit a completed case. A company may grant the same
-- permission to a custom “Performance Agent” role from the role library.
INSERT INTO role_preset_permissions (role_preset_code, permission_code)
VALUES ('hr_officer', 'disciplinary_actions.submit')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'disciplinary_actions.submit'
WHERE r.code = 'hr_officer'
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS disciplinary_actions_submission_idx
  ON disciplinary_actions (organization_id, status, submitted_at DESC)
  WHERE submitted_at IS NOT NULL;

COMMIT;