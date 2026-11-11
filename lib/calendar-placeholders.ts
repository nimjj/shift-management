// Kept apart from lib/google/calendar.ts (server-only) so the Settings form can import it.
export const CALENDAR_PLACEHOLDER_LIST = ["block", "start_local", "end_local", "checkin_link", "agent"] as const;
export type CalendarPlaceholder = (typeof CALENDAR_PLACEHOLDER_LIST)[number];
