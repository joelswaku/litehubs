-- Site-wide appointment configuration is a workspace-owner responsibility.
-- Reception staff retain their normal queue controls, but cannot change hours,
-- public channels, welcome text, or the public TV call-message library.
DELETE FROM role_preset_permissions
WHERE permission_code = 'appointments.manage_messages'
  AND role_preset_code <> 'owner';

DELETE FROM role_permissions rp
USING roles r, permissions p
WHERE rp.organization_id = r.organization_id
  AND rp.role_id = r.id
  AND p.code = 'appointments.manage_messages'
  AND r.code <> 'owner';