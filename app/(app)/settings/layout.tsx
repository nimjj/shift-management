import Link from "next/link";
import { requireSupervisor } from "@/lib/auth";

const SECTIONS = [
  { href: "/settings/general", label: "General" },
  { href: "/settings/templates", label: "Shift templates" },
  { href: "/settings/checkin", label: "Check-in rules" },
  { href: "/settings/rules", label: "Notification rules" },
  { href: "/settings/groups", label: "Groups & subscriptions" },
  { href: "/settings/calendar", label: "Calendar" },
  { href: "/settings/employees", label: "Employees & roles" },
  { href: "/settings/audit", label: "Audit log" },
];

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requireSupervisor();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <nav className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-b pb-2 text-sm">
          {SECTIONS.map((s) => (
            <Link key={s.href} href={s.href} className="text-muted-foreground hover:text-foreground">
              {s.label}
            </Link>
          ))}
        </nav>
      </div>
      {children}
    </div>
  );
}
