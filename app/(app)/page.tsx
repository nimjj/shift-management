import { requireEmployee } from "@/lib/auth";

export default async function HomePage() {
  const employee = await requireEmployee();
  const isSupervisor = employee.role === "supervisor";

  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold">Hi {employee.full_name}</h1>
      <p className="text-muted-foreground">
        {isSupervisor
          ? "You are signed in as a supervisor. The shift dashboard arrives in a later milestone; for now you can manage the team under Settings."
          : "You are signed in as an agent. Your shifts and check-in will appear here in a later milestone."}
      </p>
    </div>
  );
}
