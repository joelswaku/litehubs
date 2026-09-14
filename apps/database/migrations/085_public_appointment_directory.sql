-- 085_public_appointment_directory.sql
-- Public booking must not run unscoped queries against RLS-protected tenant
-- tables. This narrow, read-only function exposes only sites explicitly opted
-- into a public appointment channel, and only the metadata required to book
-- or check in. It never exposes visitor, employee or operational records.

CREATE OR REPLACE FUNCTION public_appointment_sites(
  p_organization_slug text DEFAULT NULL,
  p_site_code text DEFAULT NULL
)
RETURNS TABLE (
  organization_id uuid,
  organization_slug text,
  organization_name text,
  organization_timezone text,
  site_id uuid,
  site_code text,
  site_name text,
  province_id uuid,
  province_name text,
  public_booking_enabled boolean,
  qr_checkin_enabled boolean,
  queue_display_enabled boolean,
  checkin_token uuid,
  booking_opens_at text,
  booking_closes_at text,
  slot_interval_minutes integer,
  default_service_minutes integer,
  welcome_message text,
  online_service_available boolean,
  qr_service_available boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    o.id,
    o.slug,
    o.display_name,
    o.timezone,
    s.id,
    s.code,
    s.name,
    s.province_id,
    p.name,
    settings.public_booking_enabled,
    settings.qr_checkin_enabled,
    settings.queue_display_enabled,
    settings.checkin_token,
    settings.booking_opens_at::text,
    settings.booking_closes_at::text,
    settings.slot_interval_minutes,
    settings.default_service_minutes,
    settings.welcome_message,
    EXISTS (
      SELECT 1
        FROM appointment_services service
       WHERE service.organization_id = s.organization_id
         AND service.site_id = s.id
         AND service.is_active
         AND service.allows_online_booking
    ),
    EXISTS (
      SELECT 1
        FROM appointment_services service
       WHERE service.organization_id = s.organization_id
         AND service.site_id = s.id
         AND service.is_active
         AND service.allows_qr_checkin
    )
  FROM organizations o
  JOIN sites s
    ON s.organization_id = o.id
   AND s.is_active
  JOIN provinces p
    ON p.organization_id = s.organization_id
   AND p.id = s.province_id
  JOIN appointment_site_settings settings
    ON settings.organization_id = s.organization_id
   AND settings.site_id = s.id
 WHERE o.status = 'active'
   AND (p_organization_slug IS NULL OR o.slug = p_organization_slug)
   AND (p_site_code IS NULL OR s.code = p_site_code)
   AND (settings.public_booking_enabled OR settings.qr_checkin_enabled OR settings.queue_display_enabled);
$$;

REVOKE ALL ON FUNCTION public_appointment_sites(text, text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'litehubs_app') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public_appointment_sites(text, text) TO litehubs_app';
  END IF;
END;
$$;