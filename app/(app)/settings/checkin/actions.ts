"use server";

import { revalidatePath } from "next/cache";
import { supervisorAction, type ActionResult } from "@/lib/actions";
import { checkinFormToObject, checkinRulesSchema, overrideSchema } from "./schema";

export type FormState = ActionResult | null;

function revalidate() {
  for (const p of ["/settings/checkin", "/", "/grid", "/my-shifts", "/history"]) revalidatePath(p);
}

/** The org-wide default. Takes effect immediately: statuses and the check-in window are derived. */
export async function updateCheckinRules(_prev: FormState, formData: FormData): Promise<FormState> {
  const result = await supervisorAction(checkinRulesSchema, checkinFormToObject(formData), async ({ input, mutate }) => {
    await mutate("update_checkin_rules", {
      p_open_before_min: input.open_before_min,
      p_close_rule: input.close_rule,
      p_close_after_min: input.close_after_min,
      p_late_after_min: input.late_after_min,
      p_covered_rule: input.covered_rule,
      p_covered_min: input.covered_min,
    });
  });
  if (result.ok) revalidate();
  return result;
}

/** One block's overrides. Blank fields inherit the default; all blank removes the override. */
export async function setTemplateOverride(_prev: FormState, formData: FormData): Promise<FormState> {
  const result = await supervisorAction(overrideSchema, checkinFormToObject(formData), async ({ input, mutate }) => {
    await mutate("set_template_override", {
      p_template_id: input.template_id,
      p_open_before_min: input.open_before_min,
      p_close_rule: input.close_rule,
      p_close_after_min: input.close_after_min,
      p_late_after_min: input.late_after_min,
      p_covered_rule: input.covered_rule,
      p_covered_min: input.covered_min,
    });
  });
  if (result.ok) revalidate();
  return result;
}
