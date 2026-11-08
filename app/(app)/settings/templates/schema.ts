import { z } from "zod";
import { isValidTimeZone, validateSchedule } from "@/lib/time";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour)");

const fields = {
  code: z.string().trim().regex(/^[A-Za-z0-9]{1,8}$/, "1 to 8 letters or digits"),
  name: z.string().trim().min(1, "Name is required").max(60),
  start_weekday: z.coerce.number().int().min(0).max(6),
  start_time: time,
  end_weekday: z.coerce.number().int().min(0).max(6),
  end_time: time,
  // blank = follow the organisation's client time zone
  timezone: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .refine((v) => v === null || isValidTimeZone(v), "Unknown time zone (use e.g. America/Chicago)"),
  required_headcount: z.coerce.number().int().min(1, "At least 1").max(10, "At most 10"),
  colour: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour"),
  active: z.boolean(),
};

type Fields = {
  start_weekday: number;
  start_time: string;
  end_weekday: number;
  end_time: string;
};

/** The cross-field rule: the block must end after it starts and last at most 24 hours. */
function checkSchedule(v: Fields, ctx: z.RefinementCtx) {
  const error = validateSchedule({
    startWeekday: v.start_weekday,
    startTime: v.start_time,
    endWeekday: v.end_weekday,
    endTime: v.end_time,
  });
  if (error) ctx.addIssue({ code: "custom", path: ["end_time"], message: error });
}

export const createTemplateSchema = z.object(fields).superRefine(checkSchedule);
export const updateTemplateSchema = z.object({ id: z.uuid(), ...fields }).superRefine(checkSchedule);

export function templateFormToObject(fd: FormData) {
  return {
    id: fd.get("id")?.toString(),
    code: fd.get("code")?.toString() ?? "",
    name: fd.get("name")?.toString() ?? "",
    start_weekday: fd.get("start_weekday")?.toString() ?? "",
    start_time: fd.get("start_time")?.toString() ?? "",
    end_weekday: fd.get("end_weekday")?.toString() ?? "",
    end_time: fd.get("end_time")?.toString() ?? "",
    timezone: fd.get("timezone")?.toString() ?? "",
    required_headcount: fd.get("required_headcount")?.toString() ?? "1",
    colour: fd.get("colour")?.toString() ?? "",
    active: fd.get("active") === "on",
  };
}
