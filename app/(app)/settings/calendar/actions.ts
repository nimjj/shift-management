"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { supervisorAction, type ActionResult } from "@/lib/actions";
import { syncCalendarQuietly } from "@/lib/calendar-sync";
import { calendarFormToObject, calendarSchema } from "./schema";

export type FormState = ActionResult | null;

/**
 * Calendar on/off, which calendar, and the invite wording. Switching it on re-queues the invite of
 * every assignment on a shift that has not ended (inside the same audited function), and they are
 * sent right after the save.
 */
export async function updateCalendarSettings(_prev: FormState, formData: FormData): Promise<FormState> {
  const result = await supervisorAction(calendarSchema, calendarFormToObject(formData), async ({ input, mutate }) => {
    await mutate("update_calendar_settings", {
      p_enabled: input.enabled,
      p_calendar_id: input.calendar_id || null,
      p_title_tpl: input.title_tpl,
      p_desc_tpl: input.desc_tpl,
      p_reminders_min: input.reminders,
    });
  });
  if (result.ok) {
    revalidatePath("/settings/calendar");
    revalidatePath("/grid");
    after(() => syncCalendarQuietly());
  }
  return result;
}
