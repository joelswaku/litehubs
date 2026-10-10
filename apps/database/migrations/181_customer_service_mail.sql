BEGIN;

-- "Service client et réseaux sociaux" also answers customer e-mails.
-- Read and send only: the owner still chooses which mailboxes the member
-- can use (Messagerie → Boîtes e-mail), and only mail.manage can connect,
-- change or remove a mailbox.
INSERT INTO role_preset_permissions(role_preset_code, permission_code)
SELECT rp.code, p.code FROM role_presets rp CROSS JOIN permissions p
WHERE rp.code = 'social_media_manager' AND p.resource = 'mail' AND p.action IN ('read', 'send')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'social_media_manager' AND p.resource = 'mail' AND p.action IN ('read', 'send')
ON CONFLICT DO NOTHING;

COMMIT;
