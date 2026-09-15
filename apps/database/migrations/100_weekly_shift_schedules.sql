-- 100_weekly_shift_schedules.sql
-- Weekly recurring work plans, verified hour snapshots, and an employer-configured overtime premium.
-- Existing shifts retain their previous all-days behaviour until a manager edits the weekly plan.

ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS weekly_schedule jsonb;

UPDATE shifts
   SET weekly_schedule = jsonb_build_array(
     jsonb_build_object('day', 1, 'enabled', true, 'startsAt', to_char(starts_at, 'HH24:MI'), 'endsAt', to_char(ends_at, 'HH24:MI'), 'breakMinutes', 0),
     jsonb_build_object('day', 2, 'enabled', true, 'startsAt', to_char(starts_at, 'HH24:MI'), 'endsAt', to_char(ends_at, 'HH24:MI'), 'breakMinutes', 0),
     jsonb_build_object('day', 3, 'enabled', true, 'startsAt', to_char(starts_at, 'HH24:MI'), 'endsAt', to_char(ends_at, 'HH24:MI'), 'breakMinutes', 0),
     jsonb_build_object('day', 4, 'enabled', true, 'startsAt', to_char(starts_at, 'HH24:MI'), 'endsAt', to_char(ends_at, 'HH24:MI'), 'breakMinutes', 0),
     jsonb_build_object('day', 5, 'enabled', true, 'startsAt', to_char(starts_at, 'HH24:MI'), 'endsAt', to_char(ends_at, 'HH24:MI'), 'breakMinutes', 0),
     jsonb_build_object('day', 6, 'enabled', true, 'startsAt', to_char(starts_at, 'HH24:MI'), 'endsAt', to_char(ends_at, 'HH24:MI'), 'breakMinutes', 0),
     jsonb_build_object('day', 7, 'enabled', true, 'startsAt', to_char(starts_at, 'HH24:MI'), 'endsAt', to_char(ends_at, 'HH24:MI'), 'breakMinutes', 0)
   )
 WHERE weekly_schedule IS NULL;

ALTER TABLE shifts
  ALTER COLUMN weekly_schedule SET NOT NULL;

ALTER TABLE shifts
  ALTER COLUMN weekly_schedule SET DEFAULT '[]'::jsonb;

ALTER TABLE shifts
  ADD CONSTRAINT shifts_weekly_schedule_array_check
  CHECK (jsonb_typeof(weekly_schedule) = 'array' AND jsonb_array_length(weekly_schedule) = 7)
  NOT VALID;

ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS expected_minutes integer,
  ADD COLUMN IF NOT EXISTS worked_minutes integer,
  ADD COLUMN IF NOT EXISTS overtime_minutes integer;

ALTER TABLE attendance_records
  ADD CONSTRAINT attendance_expected_minutes_non_negative
  CHECK (expected_minutes IS NULL OR expected_minutes >= 0)
  NOT VALID,
  ADD CONSTRAINT attendance_worked_minutes_non_negative
  CHECK (worked_minutes IS NULL OR worked_minutes >= 0)
  NOT VALID,
  ADD CONSTRAINT attendance_overtime_minutes_non_negative
  CHECK (overtime_minutes IS NULL OR overtime_minutes >= 0)
  NOT VALID;

ALTER TABLE employee_compensation
  ADD COLUMN IF NOT EXISTS overtime_multiplier numeric(5,2);

ALTER TABLE employee_compensation
  ADD CONSTRAINT employee_compensation_overtime_multiplier_range
  CHECK (overtime_multiplier IS NULL OR (overtime_multiplier >= 1 AND overtime_multiplier <= 10))
  NOT VALID;

COMMENT ON COLUMN shifts.weekly_schedule IS
  'Seven ISO weekday entries. A weekly template repeats automatically until the assignment ends.';
COMMENT ON COLUMN attendance_records.expected_minutes IS
  'Planned paid minutes snapshot at clock-in; retained even if the shift template changes later.';
COMMENT ON COLUMN attendance_records.overtime_minutes IS
  'Verified minutes beyond the planned minutes after clock-out or correction.';
COMMENT ON COLUMN employee_compensation.overtime_multiplier IS
  'Employer-approved hourly overtime multiplier. NULL means overtime is tracked but not automatically paid.';