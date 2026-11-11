import "server-only";
import type { CalendarPlaceholder } from "@/lib/calendar-placeholders";
import { googleAccessToken, googleError } from "@/lib/google/auth";
import { renderTemplate } from "@/lib/rules/template";

// Google Calendar, as the calendar owner (service account with domain-wide delegation).
// Every call is idempotent: the event id is derived from the assignment id, so creating twice
// updates the same event instead of making a second one, and deleting twice is a no-op.

const SCOPE = "https://www.googleapis.com/auth/calendar.events";
const BASE = "https://www.googleapis.com/calendar/v3/calendars";

/**
 * Calendar event ids may only use 0-9 and a-v. A uuid without its dashes is hex, which fits.
 * One assignment row = one event, for as long as that row lives.
 */
export function eventIdFor(assignmentId: string): string {
  return `sb${assignmentId.replace(/-/g, "").toLowerCase()}`;
}

export type InviteInput = {
  assignmentId: string;
  attendeeEmail: string;
  startsAt: string;
  endsAt: string;
  titleTpl: string;
  descTpl: string;
  remindersMin: readonly number[];
  values: Record<CalendarPlaceholder, string>;
};

/** The Calendar API event resource for an assignment. Pure. */
export function buildEvent(input: InviteInput) {
  return {
    id: eventIdFor(input.assignmentId),
    status: "confirmed",
    summary: renderTemplate(input.titleTpl, input.values),
    description: renderTemplate(input.descTpl, input.values),
    start: { dateTime: new Date(input.startsAt).toISOString(), timeZone: "UTC" },
    end: { dateTime: new Date(input.endsAt).toISOString(), timeZone: "UTC" },
    attendees: [{ email: input.attendeeEmail }],
    guestsCanInviteOthers: false,
    reminders: {
      useDefault: false,
      overrides: input.remindersMin.map((minutes) => ({ method: "popup", minutes })),
    },
  };
}

async function call(owner: string, url: string, init: RequestInit): Promise<Response> {
  const token = await googleAccessToken(owner, SCOPE);
  return fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    cache: "no-store",
  });
}

/** Create the event, or update it when it already exists (also revives a cancelled one). */
export async function upsertEvent(calendarId: string, owner: string, event: ReturnType<typeof buildEvent>) {
  const calendar = `${BASE}/${encodeURIComponent(calendarId)}/events`;

  const created = await call(owner, `${calendar}?sendUpdates=all`, { method: "POST", body: JSON.stringify(event) });
  if (created.ok) return;
  if (created.status !== 409) throw await googleError(created);

  const updated = await call(owner, `${calendar}/${event.id}?sendUpdates=all`, {
    method: "PUT",
    body: JSON.stringify(event),
  });
  if (!updated.ok) throw await googleError(updated);
}

/** Delete the event, which emails the attendee a cancellation. Already gone counts as success. */
export async function deleteEvent(calendarId: string, owner: string, eventId: string) {
  const res = await call(owner, `${BASE}/${encodeURIComponent(calendarId)}/events/${eventId}?sendUpdates=all`, {
    method: "DELETE",
  });
  if (res.ok || res.status === 404 || res.status === 410) return;
  throw await googleError(res);
}

/**
 * Reminders set by the organiser only show on the organiser's own copy of an event. To give the
 * agent the 30 / 10 minute pop-ups, set them on the agent's copy, acting as the agent. Best effort:
 * the invite itself has already been sent, so a failure here is not a failed invite.
 */
export async function setAttendeeReminders(attendeeEmail: string, eventId: string, remindersMin: readonly number[]) {
  const body = JSON.stringify({
    reminders: { useDefault: false, overrides: remindersMin.map((minutes) => ({ method: "popup", minutes })) },
  });
  const url = `${BASE}/primary/events/${eventId}?sendUpdates=none`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await call(attendeeEmail, url, { method: "PATCH", body });
      if (res.ok) return true;
    } catch {
      // fall through to the retry
    }
    await new Promise((r) => setTimeout(r, 1500)); // the invite can take a moment to reach their calendar
  }
  return false;
}
