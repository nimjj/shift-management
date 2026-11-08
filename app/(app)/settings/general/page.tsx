import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSupervisor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { GeneralForm } from "./general-form";

export const metadata = { title: "General settings · ShiftBoard" };

export default async function GeneralSettingsPage() {
  await requireSupervisor();
  const supabase = await createClient();
  const { data: settings, error } = await supabase.from("org_settings").select("*").eq("id", 1).single();
  if (error) throw error;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">General</CardTitle>
      </CardHeader>
      <CardContent>
        {/* key resets the form's defaults after each successful save */}
        <GeneralForm key={settings.updated_at} settings={settings} />
      </CardContent>
    </Card>
  );
}
