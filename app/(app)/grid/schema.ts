import { z } from "zod";
import { ASSIGNMENT_ROLES, MAX_GRID_OFFSET } from "@/lib/assignments";

const uuid = z.string().uuid("That shift is not on the grid any more. Reload the page.");

export const setAssignmentsSchema = z.object({
  shift_id: uuid,
  assignees: z
    .array(z.object({ employee_id: z.string().uuid(), role: z.enum(ASSIGNMENT_ROLES) }))
    .max(20, "At most 20 people on one shift."),
});

export const copyWeekSchema = z.object({
  offset: z.coerce.number().int().min(-MAX_GRID_OFFSET).max(MAX_GRID_OFFSET),
  from_index: z.coerce.number().int().min(0).max(11),
  to_index: z.coerce.number().int().min(0).max(11),
});

/**
 * The cell editor posts one `assignee` field per ticked person, as "<employee id>:<role>".
 * Anything malformed is dropped here and caught by the schema above.
 */
export function assignmentsFormToObject(formData: FormData) {
  const assignees = formData
    .getAll("assignee")
    .map((v) => v.toString().split(":"))
    .filter((parts): parts is [string, string] => parts.length === 2)
    .map(([employee_id, role]) => ({ employee_id, role }));

  return { shift_id: formData.get("shift_id")?.toString() ?? "", assignees };
}
