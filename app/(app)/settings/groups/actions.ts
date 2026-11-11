"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supervisorAction, type ActionResult } from "@/lib/actions";
import { employeePrefsSchema, prefsFormToObject } from "@/lib/prefs-schema";

export type FormState = ActionResult | null;

const PATH = "/settings/groups";

const groupSchema = z.object({
  id: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.string().uuid().optional()),
  name: z.string().trim().min(1, "Give the group a name").max(80),
  member_ids: z.array(z.string().uuid()),
});

/** Create a notification group, or rename it and replace its members. */
export async function saveGroup(_prev: FormState, formData: FormData): Promise<FormState> {
  const result = await supervisorAction(
    groupSchema,
    {
      id: formData.get("id")?.toString() ?? "",
      name: formData.get("name")?.toString() ?? "",
      member_ids: formData.getAll("member_ids").map((v) => v.toString()),
    },
    async ({ input, mutate }) => {
      await mutate("save_notification_group", {
        p_id: input.id ?? null,
        p_name: input.name,
        p_member_ids: input.member_ids,
      });
    },
  );
  if (result.ok) {
    revalidatePath(PATH);
    revalidatePath("/settings/rules");
    revalidatePath("/notifications");
  }
  return result;
}

/** Refused (with the stage names) while a notification rule still sends to the group. */
export async function deleteGroup(_prev: FormState, formData: FormData): Promise<FormState> {
  const result = await supervisorAction(
    z.object({ id: z.string().uuid() }),
    { id: formData.get("id")?.toString() ?? "" },
    async ({ input, mutate }) => {
      await mutate("delete_notification_group", { p_id: input.id });
    },
  );
  if (result.ok) {
    revalidatePath(PATH);
    revalidatePath("/notifications");
  }
  return result;
}

/** A supervisor overriding someone's channels and quiet hours. */
export async function updateEmployeePrefs(_prev: FormState, formData: FormData): Promise<FormState> {
  const result = await supervisorAction(employeePrefsSchema, prefsFormToObject(formData), async ({ input, mutate }) => {
    await mutate("update_employee_prefs", {
      p_employee_id: input.employee_id,
      p_channels: input.channels,
      p_quiet_start: input.quiet_start,
      p_quiet_end: input.quiet_end,
    });
  });
  if (result.ok) {
    revalidatePath(PATH);
    revalidatePath("/notifications");
  }
  return result;
}
