import { redirect } from "next/navigation";
import { requireSupervisor } from "@/lib/auth";

export default async function SettingsIndexPage() {
  await requireSupervisor();
  redirect("/settings/employees");
}
