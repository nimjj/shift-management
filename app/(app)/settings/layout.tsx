import Link from "next/link";
import { requireSupervisor } from "@/lib/auth";

const SECTIONS = [{ href: "/settings/employees", label: "Employees & roles" }];

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requireSupervisor();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <nav className="mt-3 flex gap-4 border-b pb-2 text-sm">
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
