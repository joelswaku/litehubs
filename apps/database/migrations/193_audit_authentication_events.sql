-- 193_audit_authentication_events.sql
-- The audit log records every account event, not only sign-ins:
--   signup                  a company owner creates an account
--   account_activation      an invited person activates their access
--   password_reset_request  "forgot password" link requested (known account)
-- login, login_failed, logout and password_change already exist.

BEGIN;

ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_action_check
  CHECK (action IN ('create', 'read', 'update', 'delete', 'login',
                    'login_failed', 'logout', 'approve', 'reject', 'export',
                    'import', 'invite', 'permission_change', 'role_change',
                    'password_change', 'switch_organization', 'post',
                    'reverse', 'cancel', 'signup', 'account_activation',
                    'password_reset_request'));

COMMIT;
