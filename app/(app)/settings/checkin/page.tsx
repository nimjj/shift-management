import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSupervisor } from "@/lib/auth";
import { describeRules, effectiveRules } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";
import { RulesForm, type RuleValues } from "./rules-form";

export const metadata = { title: "Check-in rules · ShiftBoard" };

const EMPTY: RuleValues = {
  open_before_min: null,
  close_rule: null,
  close_after_min: null,
  late_after_min: null,
  covered_rule: null,
  covered_min: null,
};

export default async function CheckinRulesPage() {
  await requireSupervisor();
  const supabase = await createClient();

  const [orgRes, templatesRes, overridesRes] = await Promise.all([
    supabase.from("org_settings").select("*").eq("id", 1).single(),
    supabase.from("shift_templates").select("id, code, name, colour, active").order("code"),
    supabase.from("template_overrides").select("*"),
  ]);
  if (orgRes.error) throw orgRes.error;
  if (templatesRes.error) throw templatesRes.error;
  if (overridesRes.error) throw overridesRes.error;

  const org = orgRes.data;
  const defaults: RuleValues = {
    open_before_min: org.checkin_open_before_min,
    close_rule: org.checkin_close_rule,
    close_after_min: org.checkin_close_after_min,
    late_after_min: org.late_after_min,
    covered_rule: org.covered_rule,
    covered_min: org.covered_min,
  };
  const overrides = new Map(overridesRes.data.map((o) => [o.template_id, o]));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Default rules</CardTitle>
          <CardDescription>
            Apply to every block unless it has its own override below. Changes take effect straight away, for shifts
            that are already running too.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RulesForm key={org.updated_at} values={defaults} />
        </CardContent>
      </Card>

      <div>
        <h2 className="text-base font-medium">Per-block overrides</h2>
        <p className="mt-1 text-sm text-muted-foreground">Leave a field blank to use the default.</p>
      </div>

      {templatesRes.data.map((t) => {
        const o = overrides.get(t.id);
        const values: RuleValues = o
          ? {
              open_before_min: o.checkin_open_before_min,
              close_rule: o.checkin_close_rule,
              close_after_min: o.checkin_close_after_min,
              late_after_min: o.late_after_min,
              covered_rule: o.covered_rule,
              covered_min: o.covered_min,
            }
          : EMPTY;
        return (
          <Card key={t.id} className={t.active ? "" : "opacity-60"}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <span className="inline-block size-3 rounded-full" style={{ backgroundColor: t.colour }} />
                {t.code} · {t.name}
                {o ? <span className="text-xs font-normal text-muted-foreground">(overridden)</span> : null}
              </CardTitle>
              <CardDescription>{describeRules(effectiveRules(org, o))}</CardDescription>
            </CardHeader>
            <CardContent>
              <RulesForm key={`${t.id}-${o?.updated_at ?? "none"}`} templateId={t.id} values={values} defaults={defaults} />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
