import { z } from "zod";
import { CHANNELS, RECIPIENT_TYPES, RULE_CONDITIONS } from "@/lib/rules/types";

export const ruleSchema = z
  .object({
    id: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.string().uuid().optional()),
    name: z.string().trim().min(1, "Give the stage a name").max(80),
    trigger_minutes: z.coerce
      .number({ message: "Minutes must be a number" })
      .int("Minutes must be a whole number")
      .min(0, "At least 0 minutes")
      .max(1440, "At most 1440 minutes"),
    condition: z.enum(RULE_CONDITIONS),
    condition_n: z.preprocess(
      (v) => (v === "" || v == null ? undefined : v),
      z.coerce.number().int().min(1, "N must be at least 1").max(20, "N must be at most 20").optional(),
    ),
    recipient_type: z.enum(RECIPIENT_TYPES),
    employee_ids: z.array(z.string().uuid()),
    group_ids: z.array(z.string().uuid()),
    recipient_role: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.enum(["supervisor", "agent"]).optional()),
    channels: z.array(z.enum(CHANNELS)).min(1, "Pick at least one channel"),
    message_tpl: z.string().trim().min(1, "Write the message").max(2000),
    template_scope: z.array(z.string().uuid()),
    enabled: z.boolean(),
    critical: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.condition === "fewer_than_n" && v.condition_n === undefined) {
      ctx.addIssue({ code: "custom", path: ["condition_n"], message: "Enter N" });
    }
    if (v.recipient_type === "employees" && v.employee_ids.length === 0) {
      ctx.addIssue({ code: "custom", path: ["employee_ids"], message: "Pick at least one person" });
    }
    if (v.recipient_type === "group" && v.group_ids.length === 0) {
      ctx.addIssue({ code: "custom", path: ["group_ids"], message: "Pick at least one group" });
    }
    if (v.recipient_type === "role" && v.recipient_role === undefined) {
      ctx.addIssue({ code: "custom", path: ["recipient_role"], message: "Pick a role" });
    }
  });

export type RuleInput = z.infer<typeof ruleSchema>;

export function ruleFormToObject(fd: FormData) {
  const all = (name: string) => fd.getAll(name).map((v) => v.toString());
  return {
    id: fd.get("id")?.toString() ?? "",
    name: fd.get("name")?.toString() ?? "",
    trigger_minutes: fd.get("trigger_minutes")?.toString() ?? "",
    condition: fd.get("condition")?.toString() ?? "",
    condition_n: fd.get("condition_n")?.toString() ?? "",
    recipient_type: fd.get("recipient_type")?.toString() ?? "",
    employee_ids: all("employee_ids"),
    group_ids: all("group_ids"),
    recipient_role: fd.get("recipient_role")?.toString() ?? "",
    channels: all("channels"),
    message_tpl: fd.get("message_tpl")?.toString() ?? "",
    template_scope: all("template_scope"),
    enabled: fd.get("enabled") === "on",
    critical: fd.get("critical") === "on",
  };
}

/** The jsonb the save_notification_rule() function expects. Only the fields the choices need. */
export function ruleToPayload(v: RuleInput) {
  return {
    name: v.name,
    trigger_minutes: v.trigger_minutes,
    condition: v.condition,
    condition_n: v.condition === "fewer_than_n" ? (v.condition_n ?? null) : null,
    recipient_type: v.recipient_type,
    recipient_ids: v.recipient_type === "employees" ? v.employee_ids : v.recipient_type === "group" ? v.group_ids : [],
    recipient_role: v.recipient_type === "role" ? (v.recipient_role ?? null) : null,
    channels: v.channels,
    message_tpl: v.message_tpl,
    template_scope: v.template_scope.length > 0 ? v.template_scope : null,
    enabled: v.enabled,
    critical: v.critical,
  };
}
