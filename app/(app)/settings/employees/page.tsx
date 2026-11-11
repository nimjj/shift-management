import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireSupervisor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createEmployee } from "./actions";
import { EmployeeForm, type EmployeeWithPrefs } from "./employee-form";
import { EmployeeRow } from "./employee-row";

export const metadata = { title: "Employees · ShiftBoard" };

export default async function EmployeesPage() {
  const actor = await requireSupervisor();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("employees")
    .select("*, employee_notification_prefs(display_tz, channels)")
    .order("active", { ascending: false })
    .order("full_name");
  if (error) throw error;
  const employees = (data ?? []) as EmployeeWithPrefs[];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add employee</CardTitle>
        </CardHeader>
        <CardContent>
          <EmployeeForm action={createEmployee} submitLabel="Add employee" />
        </CardContent>
      </Card>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Display TZ</TableHead>
            <TableHead>Channels</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {employees.map((e) => (
            <EmployeeRow key={e.id} employee={e} isSelf={e.id === actor.id} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
