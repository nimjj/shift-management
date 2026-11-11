import "server-only";
import { appUrl, integrationEnv } from "@/lib/env";
import { isPlaceholderEmail } from "@/lib/alerts/mime";
import { buildEvent, deleteEvent, eventIdFor, setAttendeeReminders, upsertEvent } from "@/lib/google/calendar";
import { formatInstant } from "@/lib/rules/template";
import { createServiceClient } from "@/lib/supabase/service";

// Keeps Google Calendar in step with the assignments table.
//
// The database write always happens first and never waits for Google. Each assignment carries a
// calendar_status:  pending -> sent | failed | disabled.  This module sends what is pending,
// retries what failed (up to MAX_ATTEMPTS), and cancels the invites of removed assignments (a
// trigger parks their event ids in calendar_cancellations). It runs right after a roster change
// (Next's after()) and again on every cron tick, so a Google outage heals by itself.
//
// These are system bookkeeping writes with the service role, not supervisor mutations, so they do
// not write audit rows. The supervisor's action that caused them already did.

export const MAX_CALENDAR_ATTEMPTS = 5;
const BATCH = 25;

export type SyncSummary = { sent: number; failed: number; disabled: number; cancelled: number };

function errorText(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 500);
}

/**
 * Send pending invites and cancel removed ones.
 * `assignmentIds`: only these (the Retry button). Otherwise everything due, oldest first.
 */
export async function syncCalendar(opts: { assignmentIds?: string[] } = {}): Promise<SyncSummary> {
  const summary: SyncSummary = { sent: 0, failed: 0, disabled: 0, cancelled: 0 };
  const db = createServiceClient();
  const nowIso = new Date().toISOString();

  const { data: org, error: orgError } = await db
    .from("org_settings")
    .select("client_tz, default_display_tz, calendar_enabled, calendar_id, calendar_title_tpl, calendar_desc_tpl, calendar_reminders_min")
    .eq("id", 1)
    .single();
  if (orgError) throw orgError;

  const owner = integrationEnv("GOOGLE_CALENDAR_OWNER");
  const configured = Boolean(owner && integrationEnv("GOOGLE_SERVICE_ACCOUNT_JSON"));
  const calendarId = org.calendar_id;

  let query = db
    .from("assignments")
    .select(
      "id, calendar_status, calendar_attempts, employees!assignments_employee_id_fkey(full_name, email, employee_notification_prefs(display_tz)), shifts!inner(starts_at, ends_at, shift_templates(code)), checkin_token",
    )
    .gt("shifts.ends_at", nowIso)
    .order("created_at")
    .limit(BATCH);
  query = opts.assignmentIds
    ? query.in("id", opts.assignmentIds)
    : query.or(`calendar_status.eq.pending,and(calendar_status.eq.failed,calendar_attempts.lt.${MAX_CALENDAR_ATTEMPTS})`);

  const { data: rows, error } = await query;
  if (error) throw error;

  for (const a of rows ?? []) {
    const update = (patch: {
      calendar_status: string;
      calendar_error?: string | null;
      calendar_event_id?: string | null;
      calendar_attempts?: number;
    }) => db.from("assignments").update(patch).eq("id", a.id);

    if (!org.calendar_enabled || !calendarId) {
      if (a.calendar_status !== "disabled") await update({ calendar_status: "disabled", calendar_error: null });
      summary.disabled += 1;
      continue;
    }
    if (!configured || !owner) {
      // Not counted as an attempt: it starts working the moment the variables are set.
      await update({
        calendar_status: "failed",
        calendar_error: "Google Calendar is not configured on the server (GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_CALENDAR_OWNER).",
      });
      summary.failed += 1;
      continue;
    }

    const employee = a.employees;
    const shift = a.shifts;
    try {
      if (!employee) throw new Error("The employee no longer exists.");
      if (isPlaceholderEmail(employee.email)) {
        throw new Error(`${employee.email} is a placeholder address. Enter the real email under Settings > Employees.`);
      }
      const tz = employee.employee_notification_prefs?.display_tz ?? org.default_display_tz;
      const event = buildEvent({
        assignmentId: a.id,
        attendeeEmail: employee.email,
        startsAt: shift.starts_at,
        endsAt: shift.ends_at,
        titleTpl: org.calendar_title_tpl,
        descTpl: org.calendar_desc_tpl,
        remindersMin: org.calendar_reminders_min,
        values: {
          block: shift.shift_templates?.code ?? "test",
          start_local: formatInstant(new Date(shift.starts_at), tz),
          end_local: formatInstant(new Date(shift.ends_at), tz),
          checkin_link: `${appUrl()}/checkin/${a.checkin_token}`,
          agent: employee.full_name,
        },
      });

      await upsertEvent(calendarId, owner, event);
      await update({ calendar_status: "sent", calendar_event_id: event.id, calendar_error: null });
      summary.sent += 1;

      if (org.calendar_reminders_min.length > 0) {
        await setAttendeeReminders(employee.email, event.id, org.calendar_reminders_min);
      }
    } catch (e) {
      await update({
        calendar_status: "failed",
        calendar_error: errorText(e),
        calendar_attempts: a.calendar_attempts + 1,
        // Remember the id even on failure: the event may have been created before the error.
        calendar_event_id: eventIdFor(a.id),
      });
      summary.failed += 1;
    }
  }

  // Cancellations: invites whose assignment row is gone.
  if (configured && owner && calendarId) {
    const { data: gone } = await db
      .from("calendar_cancellations")
      .select("event_id, attempts")
      .lt("attempts", MAX_CALENDAR_ATTEMPTS)
      .order("created_at")
      .limit(BATCH);
    for (const c of gone ?? []) {
      try {
        await deleteEvent(calendarId, owner, c.event_id);
        await db.from("calendar_cancellations").delete().eq("event_id", c.event_id);
        summary.cancelled += 1;
      } catch (e) {
        await db
          .from("calendar_cancellations")
          .update({ attempts: c.attempts + 1, last_error: errorText(e) })
          .eq("event_id", c.event_id);
      }
    }
  }

  return summary;
}

/** For after(): never throws, so a calendar problem can never surface as a failed roster change. */
export async function syncCalendarQuietly(opts: { assignmentIds?: string[] } = {}): Promise<void> {
  try {
    await syncCalendar(opts);
  } catch (e) {
    console.error("calendar sync failed", e);
  }
}
