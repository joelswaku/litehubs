/**
 * Farm display screens (« tableaux d'affichage »).
 *
 * A screen is a TV in an office, a hall or at the farm gate.  It opens a
 * secret link and shows, like an airport board, the live state of poultry
 * flocks, pig pens and crops.  Figures are recalculated each hour (the page
 * asks again every hour).  When a section has nothing to show, or between
 * boards if the manager wants it, the screen plays company videos.
 */
import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { db } from "../../config/database";
import { readPrivateDocument } from "../../services/file-storage.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../utils/errors";
import { withTenantContext } from "../../utils/tenant-query";
import { queueDisplayName } from "../appointments/appointments.service";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export type DisplayContext = {
  organizationId: string;
  userId: string;
  memberId: string;
  isOwner: boolean;
  permissions: string[];
};
export type DisplaySection = "poultry" | "pigs" | "agriculture" | "appointments";
export type DisplayInput = {
  name: string;
  siteId?: string | null;
  sections: DisplaySection[];
  rotateSeconds: number;
  videoDocumentIds: string[];
  videosBetween: boolean;
  message?: string | null;
  isActive?: boolean;
};

const VIDEO_TYPES = ["video/mp4", "video/webm"];
const newToken = () => randomBytes(24).toString("base64url");

function assertManager(context: DisplayContext) {
  if (!context.isOwner && !context.permissions.includes("reports.read"))
    throw new ForbiddenError("Réservé au propriétaire et aux responsables des rapports.");
}

function mapDisplay(row: Row) {
  return {
    id: row.id as string,
    name: row.name as string,
    siteId: (row.site_id as string | null) ?? null,
    siteName: (row.site_name as string | null) ?? null,
    token: row.token as string,
    sections: (row.sections as DisplaySection[]) ?? [],
    rotateSeconds: Number(row.rotate_seconds),
    videoDocumentIds: (row.video_document_ids as string[]) ?? [],
    videosBetween: Boolean(row.videos_between),
    message: (row.message as string | null) ?? null,
    isActive: Boolean(row.is_active),
    lastSeenAt: (row.last_seen_at as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

async function validateInput(client: PoolClient, organizationId: string, input: DisplayInput) {
  if (!input.sections.length && !input.videoDocumentIds.length)
    throw new BadRequestError("Choisissez au moins un tableau ou une vidéo à afficher.");
  if (input.siteId) {
    const site = await client.query(`SELECT 1 FROM sites WHERE organization_id=$1 AND id=$2`, [organizationId, input.siteId]);
    if (!site.rowCount) throw new BadRequestError("Site introuvable.");
  }
  if (input.videoDocumentIds.length) {
    const videos = await client.query(`SELECT id FROM documents WHERE organization_id=$1 AND id = ANY($2::uuid[]) AND mime_type = ANY($3::text[])`, [
      organizationId,
      input.videoDocumentIds,
      VIDEO_TYPES,
    ]);
    if (videos.rowCount !== new Set(input.videoDocumentIds).size) throw new BadRequestError("Choisissez des vidéos MP4 ou WebM de l’entreprise.");
  }
}

export async function listDisplays(context: DisplayContext) {
  assertManager(context);
  return withTenantContext(context, async (client) => {
    const displays = await client.query<Row>(
      `SELECT d.*, s.name AS site_name FROM farm_displays d
         LEFT JOIN sites s ON s.organization_id=d.organization_id AND s.id=d.site_id
        WHERE d.organization_id=$1 ORDER BY d.created_at`,
      [context.organizationId],
    );
    const videos = await client.query<Row>(
      `SELECT id,title,file_name,size_bytes,created_at FROM documents
        WHERE organization_id=$1 AND mime_type = ANY($2::text[]) ORDER BY created_at DESC LIMIT 200`,
      [context.organizationId, VIDEO_TYPES],
    );
    const sites = await client.query<Row>(`SELECT id,name,code FROM sites WHERE organization_id=$1 ORDER BY name`, [context.organizationId]);
    return {
      displays: displays.rows.map(mapDisplay),
      videos: videos.rows.map((row) => ({ id: row.id as string, title: (row.title as string) || (row.file_name as string), sizeBytes: Number(row.size_bytes) })),
      sites: sites.rows.map((row) => ({ id: row.id as string, name: row.name as string, code: row.code as string })),
    };
  });
}

export async function createDisplay(context: DisplayContext, input: DisplayInput) {
  assertManager(context);
  await withTenantContext(context, async (client) => {
    await validateInput(client, context.organizationId, input);
    await client.query(
      `INSERT INTO farm_displays (organization_id,name,site_id,token,sections,rotate_seconds,video_document_ids,videos_between,message,created_by_member_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        context.organizationId,
        input.name.trim(),
        input.siteId || null,
        newToken(),
        input.sections,
        input.rotateSeconds,
        input.videoDocumentIds,
        input.videosBetween,
        input.message?.trim() || null,
        context.memberId,
      ],
    );
  });
  return listDisplays(context);
}

export async function updateDisplay(context: DisplayContext, displayId: string, input: DisplayInput) {
  assertManager(context);
  await withTenantContext(context, async (client) => {
    await validateInput(client, context.organizationId, input);
    const updated = await client.query(
      `UPDATE farm_displays SET name=$3,site_id=$4,sections=$5,rotate_seconds=$6,video_document_ids=$7,videos_between=$8,message=$9,
              is_active=COALESCE($10,is_active),updated_at=now()
        WHERE organization_id=$1 AND id=$2`,
      [
        context.organizationId,
        displayId,
        input.name.trim(),
        input.siteId || null,
        input.sections,
        input.rotateSeconds,
        input.videoDocumentIds,
        input.videosBetween,
        input.message?.trim() || null,
        input.isActive ?? null,
      ],
    );
    if (!updated.rowCount) throw new NotFoundError("Écran introuvable");
  });
  return listDisplays(context);
}

/** A new secret link: the old one stops working immediately. */
export async function regenerateDisplayLink(context: DisplayContext, displayId: string) {
  assertManager(context);
  await withTenantContext(context, async (client) => {
    const updated = await client.query(`UPDATE farm_displays SET token=$3,updated_at=now() WHERE organization_id=$1 AND id=$2`, [
      context.organizationId,
      displayId,
      newToken(),
    ]);
    if (!updated.rowCount) throw new NotFoundError("Écran introuvable");
  });
  return listDisplays(context);
}

export async function deleteDisplay(context: DisplayContext, displayId: string) {
  assertManager(context);
  await withTenantContext(context, (client) => client.query(`DELETE FROM farm_displays WHERE organization_id=$1 AND id=$2`, [context.organizationId, displayId]));
  return listDisplays(context);
}

/* ------------------------------------------------------------------ */
/* Public screen                                                       */
/* ------------------------------------------------------------------ */

async function lookup(token: string) {
  if (!/^[\w-]{20,64}$/.test(token)) throw new NotFoundError("Écran introuvable ou désactivé");
  const result = await db.query<{ found: { id: string; organizationId: string; organizationSlug: string } | null }>(
    `SELECT public_farm_display_lookup($1) AS found`,
    [token],
  );
  const found = result.rows[0]?.found;
  if (!found) throw new NotFoundError("Écran introuvable ou désactivé");
  return found;
}
const systemContext = (organizationId: string) => ({ organizationId, userId: null });

const n = (value: unknown) => Number(value ?? 0);

async function poultryBoard(client: PoolClient, organizationId: string, siteId: string | null) {
  const rows = await client.query<Row>(
    `SELECT f.id,f.code,f.name,f.status,f.initial_bird_count,f.mortality_review_threshold,
            COALESCE(f.production_type,f.bird_type) AS kind,
            COALESCE(f.arrival_date,f.hatch_date) AS started_on,
            h.name AS house_name,s.name AS site_name,
            COALESCE((SELECT sum(death_count) FROM poultry_mortality_records m WHERE m.organization_id=f.organization_id AND m.flock_id=f.id),0) AS deaths_total,
            COALESCE((SELECT sum(death_count) FROM poultry_mortality_records m WHERE m.organization_id=f.organization_id AND m.flock_id=f.id AND m.mortality_date=current_date),0) AS deaths_today,
            COALESCE((SELECT sum(death_count) FROM poultry_mortality_records m WHERE m.organization_id=f.organization_id AND m.flock_id=f.id AND m.mortality_date>=current_date-6),0) AS deaths_7d,
            COALESCE((SELECT sum(total_eggs) FROM poultry_egg_records r WHERE r.organization_id=f.organization_id AND r.flock_id=f.id AND r.record_date=current_date),0) AS eggs_today,
            COALESCE((SELECT sum(total_eggs) FROM poultry_egg_records r WHERE r.organization_id=f.organization_id AND r.flock_id=f.id AND r.record_date>=current_date-6),0) AS eggs_7d,
            COALESCE((SELECT sum(quantity_kg) FROM poultry_feed_records r WHERE r.organization_id=f.organization_id AND r.flock_id=f.id AND r.feed_date=current_date),0) AS feed_today,
            COALESCE((SELECT sum(volume_liters) FROM poultry_water_records r WHERE r.organization_id=f.organization_id AND r.flock_id=f.id AND r.water_date=current_date),0) AS water_today
       FROM poultry_flocks f
       JOIN poultry_houses h ON h.organization_id=f.organization_id AND h.id=f.house_id
       JOIN sites s ON s.organization_id=h.organization_id AND s.id=h.site_id
      WHERE f.organization_id=$1 AND f.status IN ('active','quarantined') AND ($2::uuid IS NULL OR h.site_id=$2)
      ORDER BY s.name,h.name,f.code
      LIMIT 60`,
    [organizationId, siteId],
  );
  const flocks = rows.rows.map((row) => {
    const alive = Math.max(0, n(row.initial_bird_count) - n(row.deaths_total));
    const started = row.started_on ? new Date(row.started_on) : null;
    const ageDays = started ? Math.max(0, Math.floor((Date.now() - started.getTime()) / 86_400_000)) : null;
    const alert = row.status === "quarantined" ? "quarantine" : n(row.deaths_today) >= n(row.mortality_review_threshold) && n(row.deaths_today) > 0 ? "mortality" : "ok";
    return {
      code: row.code as string,
      name: row.name as string,
      kind: (row.kind as string | null) ?? null,
      house: row.house_name as string,
      site: row.site_name as string,
      ageDays,
      alive,
      deathsToday: n(row.deaths_today),
      deaths7d: n(row.deaths_7d),
      eggsToday: n(row.eggs_today),
      eggs7d: n(row.eggs_7d),
      feedTodayKg: n(row.feed_today),
      waterTodayL: n(row.water_today),
      status: alert as "ok" | "mortality" | "quarantine",
    };
  });
  return {
    totals: {
      flocks: flocks.length,
      birds: flocks.reduce((sum, item) => sum + item.alive, 0),
      eggsToday: flocks.reduce((sum, item) => sum + item.eggsToday, 0),
      deathsToday: flocks.reduce((sum, item) => sum + item.deathsToday, 0),
      feedTodayKg: flocks.reduce((sum, item) => sum + item.feedTodayKg, 0),
      alerts: flocks.filter((item) => item.status !== "ok").length,
    },
    rows: flocks,
  };
}

async function pigBoard(client: PoolClient, organizationId: string, siteId: string | null) {
  const rows = await client.query<Row>(
    `SELECT p.id,p.code,p.name,p.pen_type,p.capacity,s.name AS site_name,
            COALESCE((SELECT sum(initial_count) FROM pig_groups g WHERE g.organization_id=p.organization_id AND g.pen_id=p.id AND g.status='active'),0)
              + (SELECT count(*) FROM pig_animals a WHERE a.organization_id=p.organization_id AND a.pen_id=p.id AND a.group_id IS NULL AND a.status IN ('active','pregnant','lactating','quarantined')) AS head_count,
            (SELECT count(*) FROM pig_pregnancies x WHERE x.organization_id=p.organization_id AND x.pen_id=p.id AND x.status IN ('suspected','confirmed')) AS pregnancies,
            (SELECT count(*) FROM pig_quarantine_records q WHERE q.organization_id=p.organization_id AND q.pen_id=p.id AND q.status='active') AS quarantines,
            COALESCE((SELECT sum(death_count) FROM pig_mortality_records m WHERE m.organization_id=p.organization_id AND m.pen_id=p.id AND m.mortality_date>=current_date-6),0) AS deaths_7d,
            COALESCE((SELECT sum(quantity_kg) FROM pig_feed_records r WHERE r.organization_id=p.organization_id AND r.pen_id=p.id AND r.feed_date=current_date),0) AS feed_today
       FROM pig_pens p
       JOIN sites s ON s.organization_id=p.organization_id AND s.id=p.site_id
      WHERE p.organization_id=$1 AND p.is_active AND ($2::uuid IS NULL OR p.site_id=$2)
      ORDER BY s.name,p.code
      LIMIT 60`,
    [organizationId, siteId],
  );
  const pens = rows.rows
    .map((row) => ({
      code: row.code as string,
      name: row.name as string,
      type: (row.pen_type as string | null) ?? null,
      site: row.site_name as string,
      capacity: row.capacity === null ? null : n(row.capacity),
      heads: n(row.head_count),
      pregnancies: n(row.pregnancies),
      deaths7d: n(row.deaths_7d),
      feedTodayKg: n(row.feed_today),
      status: (n(row.quarantines) > 0 ? "quarantine" : n(row.deaths_7d) > 0 ? "mortality" : "ok") as "ok" | "mortality" | "quarantine",
    }))
    .filter((pen) => pen.heads > 0 || pen.pregnancies > 0 || pen.status !== "ok");
  return {
    totals: {
      pens: pens.length,
      heads: pens.reduce((sum, item) => sum + item.heads, 0),
      pregnancies: pens.reduce((sum, item) => sum + item.pregnancies, 0),
      deaths7d: pens.reduce((sum, item) => sum + item.deaths7d, 0),
      feedTodayKg: pens.reduce((sum, item) => sum + item.feedTodayKg, 0),
      alerts: pens.filter((item) => item.status !== "ok").length,
    },
    rows: pens,
  };
}

async function agricultureBoard(client: PoolClient, organizationId: string, siteId: string | null) {
  const rows = await client.query<Row>(
    `SELECT pl.code,pl.name,pl.status,pl.planting_date,pl.expected_harvest_date,pl.planted_area_ha,
            c.name AS crop_name,fi.name AS field_name,s.name AS site_name,
            COALESCE((SELECT sum(quantity) FROM agriculture_harvest_records h WHERE h.organization_id=pl.organization_id AND h.planting_id=pl.id),0) AS harvested,
            (SELECT max(unit) FROM agriculture_harvest_records h WHERE h.organization_id=pl.organization_id AND h.planting_id=pl.id) AS unit,
            c.default_yield_unit
       FROM agriculture_plantings pl
       JOIN agriculture_crops c ON c.organization_id=pl.organization_id AND c.id=pl.crop_id
       JOIN agriculture_plots po ON po.organization_id=pl.organization_id AND po.id=pl.plot_id
       JOIN agriculture_fields fi ON fi.organization_id=po.organization_id AND fi.id=po.field_id
       JOIN agriculture_farms fa ON fa.organization_id=fi.organization_id AND fa.id=fi.farm_id
       JOIN sites s ON s.organization_id=fa.organization_id AND s.id=fa.site_id
      WHERE pl.organization_id=$1 AND pl.status IN ('planned','planted','growing','harvesting') AND ($2::uuid IS NULL OR fa.site_id=$2)
      ORDER BY pl.expected_harvest_date NULLS LAST, pl.planting_date
      LIMIT 60`,
    [organizationId, siteId],
  );
  const today = new Date(new Date().toISOString().slice(0, 10)).getTime();
  const plantings = rows.rows.map((row) => {
    const expected = row.expected_harvest_date ? new Date(row.expected_harvest_date).getTime() : null;
    const daysToHarvest = expected === null ? null : Math.round((expected - today) / 86_400_000);
    return {
      code: row.code as string,
      name: row.name as string,
      crop: row.crop_name as string,
      field: row.field_name as string,
      site: row.site_name as string,
      areaHa: n(row.planted_area_ha),
      plantedOn: row.planting_date ? new Date(row.planting_date).toISOString().slice(0, 10) : null,
      expectedHarvest: row.expected_harvest_date ? new Date(row.expected_harvest_date).toISOString().slice(0, 10) : null,
      daysToHarvest,
      harvested: n(row.harvested),
      unit: (row.unit as string | null) ?? (row.default_yield_unit as string | null) ?? "kg",
      status: row.status as string,
      late: daysToHarvest !== null && daysToHarvest < 0 && row.status !== "harvesting",
    };
  });
  const harvest30 = await client.query<{ total: string }>(
    `SELECT COALESCE(sum(h.quantity),0)::text AS total FROM agriculture_harvest_records h
       JOIN agriculture_plantings pl ON pl.organization_id=h.organization_id AND pl.id=h.planting_id
       JOIN agriculture_plots po ON po.organization_id=pl.organization_id AND po.id=pl.plot_id
       JOIN agriculture_fields fi ON fi.organization_id=po.organization_id AND fi.id=po.field_id
       JOIN agriculture_farms fa ON fa.organization_id=fi.organization_id AND fa.id=fi.farm_id
      WHERE h.organization_id=$1 AND h.harvest_date>=current_date-29 AND ($2::uuid IS NULL OR fa.site_id=$2)`,
    [organizationId, siteId],
  );
  return {
    totals: {
      plantings: plantings.length,
      areaHa: Number(plantings.reduce((sum, item) => sum + item.areaHa, 0).toFixed(2)),
      harvestSoon: plantings.filter((item) => item.daysToHarvest !== null && item.daysToHarvest >= 0 && item.daysToHarvest <= 14).length,
      harvested30d: n(harvest30.rows[0]?.total),
      late: plantings.filter((item) => item.late).length,
    },
    rows: plantings,
  };
}

/** Everything the screen shows; figures are as of `generatedAt`. */
export async function publicDisplay(token: string) {
  const found = await lookup(token);
  return withTenantContext(systemContext(found.organizationId), async (client) => {
    const display = (
      await client.query<Row>(
        `SELECT d.*, s.name AS site_name, COALESCE(o.display_name,o.legal_name,o.slug) AS company, settings.logo_url
           FROM farm_displays d
           JOIN organizations o ON o.id=d.organization_id
           LEFT JOIN organization_settings settings ON settings.organization_id=o.id
           LEFT JOIN sites s ON s.organization_id=d.organization_id AND s.id=d.site_id
          WHERE d.organization_id=$1 AND d.id=$2`,
        [found.organizationId, found.id],
      )
    ).rows[0];
    if (!display) throw new NotFoundError("Écran introuvable ou désactivé");
    await client.query(`UPDATE farm_displays SET last_seen_at=now() WHERE organization_id=$1 AND id=$2`, [found.organizationId, found.id]);
    const sections = (display.sections as DisplaySection[]) ?? [];
    const siteId = (display.site_id as string | null) ?? null;
    const videos = (display.video_document_ids as string[])?.length
      ? (
          await client.query<Row>(
            `SELECT id,title,file_name FROM documents WHERE organization_id=$1 AND id = ANY($2::uuid[]) AND mime_type = ANY($3::text[])`,
            [found.organizationId, display.video_document_ids, VIDEO_TYPES],
          )
        ).rows.map((row) => ({ id: row.id as string, title: (row.title as string) || (row.file_name as string) }))
      : [];
    return {
      display: {
        name: display.name as string,
        company: display.company as string,
        logoUrl: (display.logo_url as string | null) ?? null,
        site: (display.site_name as string | null) ?? null,
        sections,
        rotateSeconds: Number(display.rotate_seconds),
        videosBetween: Boolean(display.videos_between),
        message: (display.message as string | null) ?? null,
        videos,
      },
      generatedAt: new Date().toISOString(),
      poultry: sections.includes("poultry") ? await poultryBoard(client, found.organizationId, siteId) : null,
      pigs: sections.includes("pigs") ? await pigBoard(client, found.organizationId, siteId) : null,
      agriculture: sections.includes("agriculture") ? await agricultureBoard(client, found.organizationId, siteId) : null,
    };
  });
}

export async function publicDisplayVideo(token: string, documentId: string) {
  const found = await lookup(token);
  return withTenantContext(systemContext(found.organizationId), async (client) => {
    const result = await client.query<Row>(
      `SELECT doc.file_name,doc.mime_type,doc.storage_path
         FROM farm_displays d
         JOIN documents doc ON doc.organization_id=d.organization_id AND doc.id=$3 AND doc.id = ANY(d.video_document_ids)
        WHERE d.organization_id=$1 AND d.id=$2 AND doc.mime_type = ANY($4::text[])`,
      [found.organizationId, found.id, documentId, VIDEO_TYPES],
    );
    const video = result.rows[0];
    if (!video) throw new NotFoundError("Vidéo introuvable");
    return { fileName: String(video.file_name), mimeType: String(video.mime_type), buffer: await readPrivateDocument(String(video.storage_path)) };
  });
}

/**
 * Live appointment queue for a screen (asked every few seconds, unlike the
 * hourly farm figures).  Names are shortened like on the reception screen.
 */
export async function publicDisplayQueue(token: string) {
  const found = await lookup(token);
  return withTenantContext(systemContext(found.organizationId), async (client) => {
    const display = (
      await client.query<Row>(`SELECT site_id,sections FROM farm_displays WHERE organization_id=$1 AND id=$2`, [found.organizationId, found.id])
    ).rows[0];
    if (!display || !(display.sections as string[]).includes("appointments")) return { enabled: false, nowServing: [], waiting: [], servedToday: 0, upcoming: [] };
    const siteId = (display.site_id as string | null) ?? null;
    const rows = await client.query<Row>(
      `SELECT a.id,a.queue_number,a.status,a.visitor_name,a.called_at,svc.name AS service_name,desk.name AS desk_name,s.name AS site_name
         FROM appointments a
         LEFT JOIN appointment_services svc ON svc.organization_id=a.organization_id AND svc.id=a.service_id
         LEFT JOIN appointment_desks desk ON desk.organization_id=a.organization_id AND desk.id=a.desk_id
         LEFT JOIN sites s ON s.organization_id=a.organization_id AND s.id=a.site_id
        WHERE a.organization_id=$1 AND ($2::uuid IS NULL OR a.site_id=$2) AND a.queue_date=CURRENT_DATE
          AND a.status IN ('waiting','checked_in','called','serving')
        ORDER BY CASE a.status WHEN 'called' THEN 0 WHEN 'serving' THEN 1 ELSE 2 END, a.called_at DESC NULLS LAST, a.queue_number
        LIMIT 40`,
      [found.organizationId, siteId],
    );
    const served = await client.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM appointments WHERE organization_id=$1 AND ($2::uuid IS NULL OR site_id=$2) AND queue_date=CURRENT_DATE AND status='completed'`,
      [found.organizationId, siteId],
    );
    const upcoming = await client.query<Row>(
      `SELECT a.scheduled_at,a.visitor_name,svc.name AS service_name
         FROM appointments a
         LEFT JOIN appointment_services svc ON svc.organization_id=a.organization_id AND svc.id=a.service_id
        WHERE a.organization_id=$1 AND ($2::uuid IS NULL OR a.site_id=$2) AND a.status='scheduled'
          AND a.scheduled_at >= now() - interval '15 minutes' AND a.scheduled_at < date_trunc('day', now()) + interval '1 day'
        ORDER BY a.scheduled_at LIMIT 12`,
      [found.organizationId, siteId],
    );
    const ticket = (row: Row) => ({
      id: row.id as string,
      ticket: Number(row.queue_number),
      visitorName: queueDisplayName(row.visitor_name as string | null),
      serviceName: (row.service_name as string | null) ?? null,
      deskName: (row.desk_name as string | null) ?? null,
      siteName: (row.site_name as string | null) ?? null,
      status: row.status as string,
      calledAt: (row.called_at as string | null) ?? null,
    });
    return {
      enabled: true,
      nowServing: rows.rows.filter((row) => row.status === "called" || row.status === "serving").map(ticket),
      waiting: rows.rows.filter((row) => row.status === "waiting" || row.status === "checked_in").map(ticket),
      servedToday: served.rows[0]?.total ?? 0,
      upcoming: upcoming.rows.map((row) => ({
        at: row.scheduled_at as string,
        visitorName: queueDisplayName(row.visitor_name as string | null),
        serviceName: (row.service_name as string | null) ?? null,
      })),
    };
  });
}
