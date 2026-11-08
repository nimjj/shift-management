"use server";

import { revalidatePath } from "next/cache";
import { supervisorAction, type ActionResult } from "@/lib/actions";
import { createEmployeeSchema, employeeFormToObject, updateEmployeeSchema } from "./schema";

export type FormState = ActionResult | null;

// Each of these is ONE database transaction: the employee write, the display-tz preference and the
// audit_log row commit together or not at all (create_employee / update_employee in
// supabase/migrations/*_atomic_employee_mutations.sql). Domain, self-lockout and duplicate-email
// rules are enforced there too.

export async function createEmployee(_prev: FormState, formData: FormData): Promise<FormState> {
  const result = await supervisorAction(
    createEmployeeSchema,
    employeeFormToObject(formData),
    async ({ input, mutate }) => {
      await mutate("create_employee", {
        p_full_name: input.full_name,
        p_email: input.email,
        p_role: input.role,
        p_active: input.active,
        p_display_tz: input.display_tz ?? undefined, // omitted -> SQL default null
      });
    },
  );

  if (result.ok) revalidatePath("/settings/employees");
  return result;
}

export async function updateEmployee(_prev: FormState, formData: FormData): Promise<FormState> {
  const result = await supervisorAction(
    updateEmployeeSchema,
    employeeFormToObject(formData),
    async ({ input, mutate }) => {
      await mutate("update_employee", {
        p_id: input.id,
        p_full_name: input.full_name,
        p_email: input.email,
        p_role: input.role,
        p_active: input.active,
        p_display_tz: input.display_tz ?? undefined,
      });
    },
  );

  if (result.ok) revalidatePath("/settings/employees");
  return result;
}
