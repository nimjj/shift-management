import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  diffHash,
  diffShifts,
  expectedShifts,
  regenerationScope,
  type ExistingShift,
  type TemplateInput,
} from "@/lib/shifts";

/**
 * Loads the data and computes what "regenerate" would change. Used by BOTH the preview page and the
 * Apply action, so what you review is computed by the exact same code that applies it.
 */
export async function loadRegeneration(supabase: SupabaseClient<Database>, now: Date = new Date()) {
  const [orgRes, templatesRes, shiftsRes] = await Promise.all([
    supabase.from("org_settings").select("*").eq("id", 1).single(),
    supabase.from("shift_templates").select("*"),
    supabase
      .from("shifts")
      .select("id, template_id, occurrence_date, starts_at, ends_at")
      .not("template_id", "is", null)
      .gt("starts_at", now.toISOString())
      .limit(2000),
  ]);
  if (orgRes.error) throw orgRes.error;
  if (templatesRes.error) throw templatesRes.error;
  if (shiftsRes.error) throw shiftsRes.error;

  const org = orgRes.data;
  const templates = templatesRes.data as TemplateInput[];
  const existing = shiftsRes.data as ExistingShift[];

  const { range } = regenerationScope(existing, now);
  const expected = range ? expectedShifts(templates, org, range.from, range.to) : [];
  const diff = diffShifts(existing, expected, now);

  return { org, templates: templatesRes.data, diff, hash: diffHash(diff), now };
}
