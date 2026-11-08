"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, supervisorAction, type ActionResult } from "@/lib/actions";
import { buildGenerationRows, MAX_GENERATE_WEEKS, regenerationPayload, type TemplateInput } from "@/lib/shifts";
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
