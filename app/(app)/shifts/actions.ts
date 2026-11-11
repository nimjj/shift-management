"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { ActionError, supervisorAction, type ActionResult } from "@/lib/actions";
import { buildGenerationRows, MAX_GENERATE_WEEKS, regenerationPayload, type TemplateInput } from "@/lib/shifts";
import { normaliseAssignees } from "@/lib/assignments";
import { syncCalendarQuietly } from "@/lib/calendar-sync";
import type { MutationData } from "@/lib/mutate";
import { loadRegeneration } from "./regenerate/compute";

export type GenerateState = ActionResult<{ requested: number; inserted: number; skipped: number }> | null;
export type ApplyState = ActionResult<{ moved: number; added: number; removed: number }> | null;

const generateSchema = z.object({ weeks: z.coerce.number().int().min(1).max(MAX_GENERATE_WEEKS) });

/** "Generate next N weeks". Idempotent: shifts that already exist are skipped. */
export async function generateShiftsAction(_prev: GenerateState, formData: FormData): Promise<GenerateState> {
  const result = await supervisorAction(
    generateSchema,
    { weeks: formData.get("weeks")?.toString() ?? "" },
    async ({ supabase, input, mutate }) => {
      const [orgRes, templatesRes] = await Promise.all([
        supabase.from("org_settings").select("*").eq("id", 1).single(),
        supabase.from("shift_templates").select("*").eq("active", true),
      ]);
      if (orgRes.error) throw orgRes.error;
      if (templatesRes.error) throw templatesRes.error;
      if (templatesRes.data.length === 0) {
        throw new ActionError("There are no active blocks. Add one under Settings › Shift templates first.");
      }

      const rows = buildGenerationRows(templatesRes.data as TemplateInput[], orgRes.data, new Date(), input.weeks);
      return mutate("generate_shifts", { p_rows: rows });
    },
  );

  if (result.ok) {
    revalidatePath("/shifts");
    revalidatePath("/shifts/regenerate");
  }
  return result;
}

const applySchema = z.object({ hash: z.string().regex(/^[0-9a-f]{64}$/) });

/**
 * Apply the regeneration the supervisor previewed. Recomputes from current data and refuses if it
 * no longer matches the preview they saw (the hash), so they never apply something unreviewed.
 */
export async function applyRegenerationAction(_prev: ApplyState, formData: FormData): Promise<ApplyState> {
  const result = await supervisorAction(
    applySchema,
    { hash: formData.get("hash")?.toString() ?? "" },
    async ({ supabase, input, mutate }) => {
      const { diff, hash } = await loadRegeneration(supabase);
      if (hash !== input.hash) {
        throw new ActionError("The shifts changed since you opened this preview. Review the updated preview and apply again.");
      }
      return mutate("apply_shift_regeneration", { p_changes: regenerationPayload(diff) });
    },
  );

  if (result.ok) {
    revalidatePath("/shifts");
    revalidatePath("/shifts/regenerate");
  }
  return result;
}

// ---------------------------------------------------------------------------
// Test shifts: try check-in and alerts without waiting for a weekend.
// ---------------------------------------------------------------------------
export type TestShiftState = ActionResult<MutationData["create_test_shift"]> | null;
export type DeleteTestShiftState = ActionResult<MutationData["delete_test_shift"]> | null;

const testShiftSchema = z.object({
  starts_in_min: z.coerce.number().int().min(-720, "At most 12 hours ago").max(10080, "At most 7 days ahead"),
  duration_min: z.coerce.number().int().min(5, "At least 5 minutes").max(1440, "At most 24 hours"),
  employee_ids: z.array(z.string().uuid()).max(20),
  notes: z.string().trim().max(200).optional(),
});

function revalidateShifts() {
  for (const p of ["/shifts", "/", "/my-shifts", "/history"]) revalidatePath(p);
}

/** "Create test shift starting in N minutes" (N may be negative: a shift that started N minutes ago). */
export async function createTestShiftAction(_prev: TestShiftState, formData: FormData): Promise<TestShiftState> {
  const result = await supervisorAction(
    testShiftSchema,
    {
      starts_in_min: formData.get("starts_in_min")?.toString() ?? "",
      duration_min: formData.get("duration_min")?.toString() ?? "",
      employee_ids: formData.getAll("employee_id").map((v) => v.toString()),
      notes: formData.get("notes")?.toString() ?? undefined,
    },
    async ({ input, mutate }) =>
      mutate("create_test_shift", {
        p_starts_in_min: input.starts_in_min,
        p_duration_min: input.duration_min,
        p_assignees: normaliseAssignees(input.employee_ids.map((employee_id) => ({ employee_id, role: "primary" }))),
        p_notes: input.notes || undefined,
      }),
  );
  if (result.ok) {
    revalidateShifts();
    after(() => syncCalendarQuietly());
  }
  return result;
}

export async function deleteTestShiftAction(
  _prev: DeleteTestShiftState,
  formData: FormData,
): Promise<DeleteTestShiftState> {
  const result = await supervisorAction(
    z.object({ shift_id: z.string().uuid() }),
    { shift_id: formData.get("shift_id")?.toString() ?? "" },
    async ({ input, mutate }) => mutate("delete_test_shift", { p_shift_id: input.shift_id }),
  );
  if (result.ok) {
    revalidateShifts();
    after(() => syncCalendarQuietly()); // cancels the invites of the deleted assignments
  }
  return result;
}
