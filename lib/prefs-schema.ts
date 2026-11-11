import { z } from "zod";
import { CHANNELS } from "@/lib/rules/types";
import { isValidTime, isValidTimeZone } from "@/lib/time";

// Notification preferences: used by "My notifications" (an employee's own) and by a supervisor
// overriding someone else's under Settings > Groups.

const optionalTime = z.preprocess(
  (v) => (v === "" || v == null ? null : typeof v === "string" ? v.slice(0, 5) : v),
  z.string().refine(isValidTime, "Use a time like 22:00").nullable(),
);

const base = {
  channels: z.array(z.enum(CHANNELS)),
  quiet_start: optionalTime,
  quiet_end: optionalTime,
};

function quietHoursCheck(v: { quiet_start: string | null; quiet_end: string | null }, ctx: z.RefinementCtx) {
  if ((v.quiet_start === null) !== (v.quiet_end === null)) {
    ctx.addIssue({ code: "custom", path: ["quiet_end"], message: "Set both a start and an end, or neither" });
  } else if (v.quiet_start !== null && v.quiet_start === v.quiet_end) {
    ctx.addIssue({ code: "custom", path: ["quiet_end"], message: "Start and end can't be the same" });
  }
}

export const myPrefsSchema = z
  .object({
    ...base,
    display_tz: z.preprocess(
      (v) => (v === "" || v == null ? null : v),
      z.string().trim().refine(isValidTimeZone, "Unknown time zone (use e.g. Asia/Colombo)").nullable(),
    ),
  })
  .superRefine(quietHoursCheck);

export const employeePrefsSchema = z.object({ employee_id: z.string().uuid(), ...base }).superRefine(quietHoursCheck);

export function prefsFormToObject(fd: FormData) {
  return {
    employee_id: fd.get("employee_id")?.toString() ?? "",
    channels: fd.getAll("channels").map((v) => v.toString()),
    quiet_start: fd.get("quiet_start")?.toString() ?? "",
    quiet_end: fd.get("quiet_end")?.toString() ?? "",
    display_tz: fd.get("display_tz")?.toString() ?? "",
  };
}
