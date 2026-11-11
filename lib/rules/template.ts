// Pure: message templates with {placeholders}.

import { formatDayIn, formatTimeIn, zoneLabelIn } from "@/lib/time";
import type { Directory, EngineEmployee, Firing } from "./types";

export const PLACEHOLDERS = [
  "block",
  "start_local",
  "end_local",
  "agents",
  "missing_agents",
  "checkin_link",
  "dashboard_link",
] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

const TOKEN = /\{([a-z_]+)\}/g;

/** Replaces {known} placeholders; anything else in braces is left exactly as written. */
export function renderTemplate(tpl: string, values: Partial<Record<string, string>>): string {
  return tpl.replace(TOKEN, (whole, name: string) => {
    const v = values[name];
    return v === undefined ? whole : v;
  });
}

/** Placeholders in the template that are not in `known`. Shown as a warning when editing. */
export function unknownPlaceholders(tpl: string, known: readonly string[] = PLACEHOLDERS): string[] {
  const set = new Set<string>(known);
  const out = new Set<string>();
  for (const m of tpl.matchAll(TOKEN)) if (!set.has(m[1])) out.add(m[1]);
  return [...out];
}

/** "Sat 7 Nov 03:30 GMT+5:30" */
export function formatInstant(instant: Date, tz: string): string {
  return `${formatDayIn(instant, tz)} ${formatTimeIn(instant, tz)} ${zoneLabelIn(instant, tz)}`;
}

function names(ids: readonly string[], dir: Directory): string {
  const list = ids.map((id) => dir.employees.get(id)?.full_name ?? "Unknown");
  return list.length > 0 ? list.join(", ") : "nobody";
}

/**
 * The values for one recipient. Times are in the recipient's own display zone. {checkin_link} is the
 * recipient's own link when they are on the shift; otherwise the link of the agent the firing is
 * about; otherwise the My shifts page.
 */
export function messageValues(
  firing: Firing,
  recipient: Pick<EngineEmployee, "id" | "display_tz">,
  dir: Directory,
  appUrl: string,
): Record<Placeholder, string> {
  const base = appUrl.replace(/\/$/, "");
  const { shift } = firing;
  const primaries = shift.assignments.filter((a) => a.role === "primary");
  const own = shift.assignments.find((a) => a.employee_id === recipient.id);
  const token = own?.checkin_token ?? firing.assignment?.checkin_token;

  return {
    block: shift.block,
    start_local: formatInstant(new Date(shift.starts_at), recipient.display_tz),
    end_local: formatInstant(new Date(shift.ends_at), recipient.display_tz),
    agents: names(
      primaries.map((a) => a.employee_id),
      dir,
    ),
    missing_agents: names(
      primaries.filter((a) => !a.checked_in_at).map((a) => a.employee_id),
      dir,
    ),
    checkin_link: token ? `${base}/checkin/${token}` : `${base}/my-shifts`,
    dashboard_link: `${base}/`,
  };
}

/** Sample values for the "Send test" button. */
export function sampleValues(appUrl: string, tz: string, now: Date): Record<Placeholder, string> {
  const base = appUrl.replace(/\/$/, "");
  return {
    block: "2a",
    start_local: formatInstant(now, tz),
    end_local: formatInstant(new Date(now.getTime() + 6 * 3_600_000), tz),
    agents: "Pooja, Thejan",
    missing_agents: "Thejan",
    checkin_link: `${base}/my-shifts`,
    dashboard_link: `${base}/`,
  };
}
