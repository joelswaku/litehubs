-- 064 added is_read with a NOT NULL default, so a legacy row that already had
-- read_at populated must be explicitly carried forward as read.
UPDATE notifications
   SET is_read = true
 WHERE read_at IS NOT NULL
   AND is_read = false;
