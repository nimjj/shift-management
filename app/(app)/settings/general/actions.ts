"use server";

import { revalidatePath } from "next/cache";
import { supervisorAction, type ActionResult } from "@/lib/actions";
import { generalFormToObject, generalSchema } from "./schema";

export type FormState = ActionResult | null;

// One transaction: update_org_settings validates, writes and audits together. It also refuses a
// domain list that would lock out the acting supervisor.
export async function updateGeneral(_prev: FormState, formData: FormData): Promise<FormState> {
  const result = await supervisorAction(generalSchema, generalFormToObject(formData), async ({ input, mutate }) => {
    await mutate("update_org_settings", {
      p_org_name: input.org_name,
      p_client_tz: input.client_tz,
      p_default_display_tz: input.default_display_tz,
      p_week_start: input.week_start,
      p_allowed_domains: input.allowed_domains,
    });
  });

  if (result.ok) {
    revalidatePath("/settings/general");
    revalidatePath("/shifts");
    revalidatePath("/settings/templates");
  }
  return result;
}
