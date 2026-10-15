-- 195_employee_messages.sql
-- Direct messages sent to an employee from their HR record: e-mail, SMS and/or
-- a LiteHubs notification. The history stays on the record (who, when, which
-- channel, delivered or not).

BEGIN;

CREATE TABLE employee_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id      uuid NOT NULL,
  subject          text,
  body             text NOT NULL,
  channels         text[] NOT NULL DEFAULT '{}',
  delivery         jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_messages_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT employee_messages_employee_fk FOREIGN KEY (organization_id, employee_id)
    REFERENCES employees(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT employee_messages_body_not_blank CHECK (btrim(body) <> ''),
  CONSTRAINT employee_messages_channels_check
    CHECK (channels <@ ARRAY['email','sms','app']::text[] AND cardinality(channels) > 0)
);
CREATE INDEX employee_messages_employee_idx ON employee_messages(organization_id, employee_id, created_at DESC);
SELECT enable_tenant_rls('employee_messages');

COMMIT;
