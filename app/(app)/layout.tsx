import Link from "next/link";
import { signOut } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { requireEmployee } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const employee = await requireEmployee();
  const isSupervisor = employee.role === "supervisor";

  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <nav className="flex items-center gap-5 text-sm">
            <Link href="/" className="font-semibold">
              ShiftBoard
            </Link>
            <Link href="/my-shifts" className="text-muted-foreground hover:text-foreground">
              My shifts
            </Link>
            {isSupervisor ? (
              <>
                <Link href="/grid" className="text-muted-foreground hover:text-foreground">
                  Grid
                </Link>
                <Link href="/shifts" className="text-muted-foreground hover:text-foreground">
                  Shifts
                </Link>
                <Link href="/settings" className="text-muted-foreground hover:text-foreground">
                  Settings
                </Link>
              </>
            ) : null}
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-muted-foreground sm:inline">
              {employee.full_name} · {employee.role}
            </span>
            <form action={signOut}>
              <Button type="submit" variant="outline" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
