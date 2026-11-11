import { z } from "zod";

/** "30, 10" -> [30, 10] (deduped, largest first). Anything that is not a whole number is rejected. */
export function parseReminders(input: string): number[] | null {
  const parts = input
    .split(/[\s,;]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.some((p) => !/^\d{1,5}$/.test(p))) return null;
  return [...new Set(parts.map(Number))].sort((a, b) => b - a);
}

export const calendarSchema = z
  .object({
    enabled: z.boolean(),
    calendar_id: z.string().trim().max(300),
    title_tpl: z.string().trim().min(1, "The event title is required").max(200),
    desc_tpl: z.string().max(4000),
    reminders: z
      .string()
      .transform((s, ctx) => {
        const list = parseReminders(s);
        if (list === null) {
          ctx.addIssue({ code: "custom", message: "Use whole minutes separated by commas, e.g. 30, 10" });
          return z.NEVER;
        }
        return list;
      })
      .pipe(z.array(z.number().int().min(0).max(40320, "At most 40320 minutes (4 weeks)")).max(5, "At most 5 reminders")),
  })
  .superRefine((v, ctx) => {
    if (v.enabled && v.calendar_id.length === 0) {
      ctx.addIssue({ code: "custom", path: ["calendar_id"], message: "Enter the calendar ID before switching invites on" });
    }
  });

export function calendarFormToObject(fd: FormData) {
  return {
    enabled: fd.get("enabled") === "on",
    calendar_id: fd.get("calendar_id")?.toString() ?? "",
    title_tpl: fd.get("title_tpl")?.toString() ?? "",
    desc_tpl: fd.get("desc_tpl")?.toString() ?? "",
    reminders: fd.get("reminders")?.toString() ?? "",
  };
}
