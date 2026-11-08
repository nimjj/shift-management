"use server";

import { revalidatePath } from "next/cache";
import { supervisorAction, type ActionResult } from "@/lib/actions";
import { createTemplateSchema, templateFormToObject, updateTemplateSchema } from "./schema";

export type FormState = ActionResult | null;

// Saving a block does NOT change shifts that already exist: new settings apply to shifts generated
// from now on, and to existing ones only through Shifts > Review & regenerate (which previews first).
// Archiving = unticking "Active".

function revalidate() {
  revalidatePath("/settings/templates");
  revalidatePath("/shifts");
  revalidatePath("/shifts/regenerate");
}

export async function createTemplate(_prev: FormState, formData: FormData): Promise<FormState> {
  const result = await supervisorAction(
    createTemplateSchema,
    templateFormToObject(formData),
    async ({ input, mutate }) => {
      await mutate("create_shift_template", {
        p_code: input.code,
        p_name: input.name,
        p_start_weekday: input.start_weekday,
        p_start_time: input.start_time,
        p_end_weekday: input.end_weekday,
        p_end_time: input.end_time,
        p_timezone: input.timezone ?? undefined, // omitted -> SQL default null (follow org zone)
        p_required_headcount: input.required_headcount,
        p_colour: input.colour,
        p_active: input.active,
      });
    },
  );
  if (result.ok) revalidate();
  return result;
}

export async function updateTemplate(_prev: FormState, formData: FormData): Promise<FormState> {
  const result = await supervisorAction(
    updateTemplateSchema,
    templateFormToObject(formData),
    async ({ input, mutate }) => {
      await mutate("update_shift_template", {
        p_id: input.id,
        p_code: input.code,
        p_name: input.name,
        p_start_weekday: input.start_weekday,
        p_start_time: input.start_time,
        p_end_weekday: input.end_weekday,
        p_end_time: input.end_time,
        p_timezone: input.timezone ?? undefined,
        p_required_headcount: input.required_headcount,
        p_colour: input.colour,
        p_active: input.active,
      });
    },
  );
  if (result.ok) revalidate();
  return result;
}
