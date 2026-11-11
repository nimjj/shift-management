import { z } from "zod";
import { CLOSE_RULES, COVERED_RULES } from "@/lib/settings";

const minutes = (min: number, max: number, label: string) =>
  z.coerce
    .number({ message: `${label} must be a number` })
    .int(`${label} must be a whole number`)
    .min(min, `${label} must be at least ${min}`)
    .max(max, `${label} must be at most ${max}`);

export const checkinRulesSchema = z.object({
  open_before_min: minutes(0, 1440, "Open before"),
  close_rule: z.enum(CLOSE_RULES),
  close_after_min: minutes(1, 1440, "Close after"),
  late_after_min: minutes(0, 1440, "Late after"),
  covered_rule: z.enum(COVERED_RULES),
  covered_min: minutes(1, 20, "Covered headcount"),
});

/** A blank field in an override means "inherit the default". */
const inherit = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === "" || v === undefined || v === null ? null : v), schema.nullable());

export const overrideSchema = z.object({
  template_id: z.string().uuid(),
  open_before_min: inherit(minutes(0, 1440, "Open before")),
  close_rule: inherit(z.enum(CLOSE_RULES)),
  close_after_min: inherit(minutes(1, 1440, "Close after")),
  late_after_min: inherit(minutes(0, 1440, "Late after")),
  covered_rule: inherit(z.enum(COVERED_RULES)),
  covered_min: inherit(minutes(1, 20, "Covered headcount")),
});

const FIELDS = ["open_before_min", "close_rule", "close_after_min", "late_after_min", "covered_rule", "covered_min"] as const;

export function checkinFormToObject(fd: FormData) {
  const out: Record<string, string> = { template_id: fd.get("template_id")?.toString() ?? "" };
  for (const f of FIELDS) out[f] = fd.get(f)?.toString() ?? "";
  return out;
}
