BEGIN;

-- Team chat.
--  * team       : one company-wide room for every active member (all provinces)
--  * direction  : one private thread per employee with the direction (owner,
--                 general managers and the members the owner authorises)
CREATE TABLE chat_conversations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind             text NOT NULL,
  employee_member_id uuid,
  title            text,
  last_message_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_conversations_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT chat_conversations_kind_check CHECK (kind IN ('team', 'direction')),
  CONSTRAINT chat_conversations_direction_member_check
    CHECK ((kind = 'direction') = (employee_member_id IS NOT NULL)),
  CONSTRAINT chat_conversations_member_fk
    FOREIGN KEY (organization_id, employee_member_id)
    REFERENCES organization_members(organization_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX chat_conversations_team_unique
  ON chat_conversations(organization_id) WHERE kind = 'team';
CREATE UNIQUE INDEX chat_conversations_direction_unique
  ON chat_conversations(organization_id, employee_member_id) WHERE kind = 'direction';
SELECT enable_tenant_rls('chat_conversations');

CREATE TABLE chat_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id  uuid NOT NULL,
  author_member_id uuid,
  body             text,
  is_announcement  boolean NOT NULL DEFAULT false,
  pinned_at        timestamptz,
  storage_path     text,
  file_name        text,
  mime_type        text,
  size_bytes       bigint,
  deleted_at       timestamptz,
  deleted_by_member_id uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_messages_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT chat_messages_conversation_fk
    FOREIGN KEY (organization_id, conversation_id)
    REFERENCES chat_conversations(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT chat_messages_author_fk
    FOREIGN KEY (organization_id, author_member_id)
    REFERENCES organization_members(organization_id, id) ON DELETE SET NULL,
  CONSTRAINT chat_messages_content_check
    CHECK (deleted_at IS NOT NULL OR btrim(coalesce(body, '')) <> '' OR storage_path IS NOT NULL)
);
CREATE INDEX chat_messages_conversation_idx
  ON chat_messages(organization_id, conversation_id, created_at DESC);
SELECT enable_tenant_rls('chat_messages');

CREATE TABLE chat_reads (
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id  uuid NOT NULL,
  member_id        uuid NOT NULL,
  last_read_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, conversation_id, member_id),
  CONSTRAINT chat_reads_conversation_fk
    FOREIGN KEY (organization_id, conversation_id)
    REFERENCES chat_conversations(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT chat_reads_member_fk
    FOREIGN KEY (organization_id, member_id)
    REFERENCES organization_members(organization_id, id) ON DELETE CASCADE
);
SELECT enable_tenant_rls('chat_reads');

-- Members the owner authorises.  Owners and general managers always have
-- both rights.
CREATE TABLE chat_access (
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  member_id           uuid NOT NULL,
  can_moderate        boolean NOT NULL DEFAULT false,
  can_read_direction  boolean NOT NULL DEFAULT false,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, member_id),
  CONSTRAINT chat_access_member_fk
    FOREIGN KEY (organization_id, member_id)
    REFERENCES organization_members(organization_id, id) ON DELETE CASCADE
);
SELECT enable_tenant_rls('chat_access');

COMMENT ON TABLE chat_conversations IS
  'Team chat: one company-wide room and one private direction thread per employee.';

COMMIT;
