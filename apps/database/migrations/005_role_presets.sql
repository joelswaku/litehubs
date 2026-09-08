-- 005_role_presets.sql
-- Platform-owned role blueprints. Provisioning copies a preset into a new
-- organization's own `roles` rows, so every tenant starts with a sensible set
-- and can then rename or re-scope them without affecting anyone else.
--
-- Presets are the source; org roles are the copy. Editing a preset later does
-- not retroactively change existing organizations.

CREATE TABLE role_presets (
  code          text PRIMARY KEY,
  name          text NOT NULL,
  description   text,
  level         integer NOT NULL DEFAULT 100,
  -- NULL means the preset applies to every industry.
  industry_code text REFERENCES industries (code) ON DELETE CASCADE,
  -- Granted to the first member when an organization is created.
  is_owner_role boolean NOT NULL DEFAULT false,
  sort_order    integer NOT NULL DEFAULT 100,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT role_presets_code_format CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT role_presets_level_range CHECK (level BETWEEN 0 AND 1000)
);

CREATE INDEX role_presets_industry_idx ON role_presets (industry_code);

-- Exactly one owner preset, since provisioning must know what to grant the
-- creating user.
CREATE UNIQUE INDEX role_presets_single_owner_idx
  ON role_presets ((true))
  WHERE is_owner_role;

CREATE TABLE role_preset_permissions (
  role_preset_code text NOT NULL
    REFERENCES role_presets (code) ON DELETE CASCADE,
  permission_code  text NOT NULL
    REFERENCES permissions (code) ON DELETE CASCADE,
  PRIMARY KEY (role_preset_code, permission_code)
);

CREATE INDEX role_preset_permissions_permission_idx
  ON role_preset_permissions (permission_code);

COMMENT ON TABLE role_presets IS
  'Blueprints copied into per-organization roles by the provisioning service.';
