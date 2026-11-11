import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { selectClass } from "@/components/form-styles";
import { requireSupervisor } from "@/lib/auth";
import { formatInstant } from "@/lib/rules/template";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Audit log · ShiftBoard" };

const PAGE_SIZE = 50;
const navLink = buttonVariants({ variant: "outline", size: "sm" });

/** What each area of the app writes under, for the filter. */
const ENTITIES = [
  ["", "Everything"],
  ["employees", "Employees"],
  ["org_settings", "General, check-in and calendar settings"],
  ["shift_templates", "Shift templates and overrides"],
  ["shifts", "Shifts and rosters"],
  ["assignments", "Calendar invite retries"],
  ["notification_rules", "Notification rules"],
  ["notification_groups", "Notification groups"],
] as const;

/** Check-in tokens are login-gated, but there is no reason to print them in a log view. */
function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, k === "checkin_token" ? "(hidden)" : redact(v)]),
    );
  }
  return value;
}

function Json({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <pre className="mt-1 max-h-72 overflow-auto rounded-lg bg-muted/50 p-2 text-xs">
        {JSON.stringify(redact(value), null, 2)}
      </pre>
    </div>
  );
}

/**
 * Every supervisor change, newest first. Rows are written by the database inside the same
 * transaction as the change itself, and nothing can edit or delete them.
 */
export default async function AuditLogPage({ searchParams }: PageProps<"/settings/audit">) {
  const actor = await requireSupervisor();
  const supabase = await createClient();
  const params = await searchParams;

  const rawPage = Number(typeof params.page === "string" ? params.page : 1);
  const page = Number.isFinite(rawPage) ? Math.max(1, Math.min(10_000, Math.trunc(rawPage))) : 1;
  const entity = ENTITIES.some(([value]) => value === params.entity) ? (params.entity as string) : "";

  let query = supabase
    .from("audit_log")
    .select("id, action, entity, entity_id, before, after, created_at, employees(full_name)", { count: "exact" })
    .order("id", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (entity) query = query.eq("entity", entity);

  const [logRes, orgRes, prefsRes] = await Promise.all([
    query,
    supabase.from("org_settings").select("default_display_tz").eq("id", 1).single(),
    supabase.from("employee_notification_prefs").select("display_tz").eq("employee_id", actor.id).maybeSingle(),
  ]);
  if (logRes.error) throw logRes.error;
  if (orgRes.error) throw orgRes.error;

  const tz = prefsRes.data?.display_tz ?? orgRes.data.default_display_tz;
  const rows = logRes.data;
  const total = logRes.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const link = (p: number) => `/settings/audit?page=${p}${entity ? `&entity=${entity}` : ""}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-medium">Audit log</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {total} change{total === 1 ? "" : "s"}. Times in {tz}. Open a row to see what changed.
          </p>
        </div>
        <form method="get" className="flex items-end gap-2">
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Show</span>
            <select name="entity" defaultValue={entity} className={`${selectClass} w-72`}>
              {ENTITIES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={navLink}>
            Filter
          </button>
        </form>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing here yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>What</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="align-top whitespace-nowrap">{formatInstant(new Date(r.created_at), tz)}</TableCell>
                <TableCell className="align-top">{r.employees?.full_name ?? "Removed employee"}</TableCell>
                <TableCell className="align-top">
                  <code className="text-xs">{r.action}</code>
                </TableCell>
                <TableCell className="align-top">
                  <details>
                    <summary className="cursor-pointer text-sm text-muted-foreground">
                      {r.entity}
                      {r.entity_id ? ` · ${r.entity_id.slice(0, 8)}` : ""}
                    </summary>
                    <div className="mt-2 grid max-w-2xl gap-3 sm:grid-cols-2">
                      <Json label="Before" value={r.before} />
                      <Json label="After" value={r.after} />
                    </div>
                  </details>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <nav className="flex items-center gap-3 text-sm">
        {page > 1 ? (
          <Link href={link(page - 1)} className={navLink}>
            ‹ Newer
          </Link>
        ) : null}
        <span className="text-muted-foreground">
          Page {page} of {pages}
        </span>
        {page < pages ? (
          <Link href={link(page + 1)} className={navLink}>
            Older ›
          </Link>
        ) : null}
      </nav>
    </div>
  );
}
