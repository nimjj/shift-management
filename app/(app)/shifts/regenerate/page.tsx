import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireSupervisor } from "@/lib/auth";
import type { ShiftTemplate } from "@/lib/database.types";
import { diffIsEmpty, effectiveTimeZone } from "@/lib/shifts";
import { createClient } from "@/lib/supabase/server";
import { formatRangeIn } from "@/lib/time";
import { ApplyForm } from "./apply-form";
import { loadRegeneration } from "./compute";

export const metadata = { title: "Regenerate shifts · ShiftBoard" };

export default async function RegeneratePage() {
  const actor = await requireSupervisor();
  const supabase = await createClient();

  const [{ org, templates, diff, hash }, prefsRes] = await Promise.all([
    loadRegeneration(supabase),
    supabase.from("employee_notification_prefs").select("display_tz").eq("employee_id", actor.id).maybeSingle(),
  ]);
  const displayTz = prefsRes.data?.display_tz ?? org.default_display_tz;
  const byId = new Map<string, ShiftTemplate>(templates.map((t) => [t.id, t]));
  const total = diff.moved.length + diff.added.length + diff.removed.length;

  const Block = ({ id }: { id: string | null }) => {
    const t = id ? byId.get(id) : undefined;
    return (
      <span className="inline-flex items-center gap-2 font-medium">
        <span className="inline-block size-3 rounded-full" style={{ backgroundColor: t?.colour ?? "#64748b" }} />
        {t?.code ?? "?"}
      </span>
    );
  };

  const both = (startsAt: string, endsAt: string, templateId: string | null) => {
    const tz = (templateId && byId.get(templateId) ? effectiveTimeZone(byId.get(templateId)!, org) : org.client_tz);
    const s = new Date(startsAt);
    const e = new Date(endsAt);
    return (
      <div className="space-y-0.5">
        <div>{formatRangeIn(s, e, tz)}</div>
        <div className="text-xs text-muted-foreground">{formatRangeIn(s, e, displayTz)}</div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <Link href="/shifts" className="text-sm text-muted-foreground underline underline-offset-4">
          ‹ Shifts
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Review &amp; regenerate future shifts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Compares the shifts that already exist (not yet started) with what your blocks would produce today. Nothing
          changes until you press Apply. Shifts that have started or finished are never touched.
        </p>
      </div>

      {diff.kept.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Kept as they are ({diff.kept.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              These shifts have people assigned, so regeneration leaves them alone — the agents already have that time
              in their calendar. Change one by hand on the grid if you need to.
            </p>
            <Table>
              <TableBody>
                {diff.kept.map((k) => (
                  <TableRow key={k.shift.id}>
                    <TableCell>
                      <Block id={k.shift.template_id} />
                    </TableCell>
                    <TableCell>{both(k.shift.starts_at, k.shift.ends_at, k.shift.template_id)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {k.change === "removed"
                        ? "would have been removed"
                        : `would have moved to ${formatRangeIn(
                            new Date(k.to!.starts_at),
                            new Date(k.to!.ends_at),
                            displayTz,
                          )}`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {diffIsEmpty(diff) ? (
        <Card>
          <CardContent className="pt-6 text-sm">
            Nothing to change: all {diff.unchanged} upcoming shift{diff.unchanged === 1 ? "" : "s"} already match your
            blocks{diff.kept.length > 0 ? ", apart from the assigned ones above" : ""}.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="secondary">{diff.moved.length} moved</Badge>
            <Badge variant="secondary">{diff.added.length} added</Badge>
            <Badge variant="secondary">{diff.removed.length} removed</Badge>
            <span className="text-muted-foreground">{diff.unchanged} unchanged</span>
          </div>

          {diff.moved.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Moved (same shift, new time)</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Block</TableHead>
                      <TableHead>Now</TableHead>
                      <TableHead>After</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {diff.moved.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell>
                          <Block id={m.template_id} />
                        </TableCell>
                        <TableCell>{both(m.from.starts_at, m.from.ends_at, m.template_id)}</TableCell>
                        <TableCell>{both(m.to.starts_at, m.to.ends_at, m.template_id)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}

          {diff.added.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Added</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableBody>
                    {diff.added.map((a) => (
                      <TableRow key={`${a.template_id}-${a.occurrence_date}`}>
                        <TableCell>
                          <Block id={a.template_id} />
                        </TableCell>
                        <TableCell>{both(a.starts_at, a.ends_at, a.template_id)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}

          {diff.removed.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Removed (no longer produced by any active block)</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableBody>
                    {diff.removed.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <Block id={r.template_id} />
                        </TableCell>
                        <TableCell>{both(r.starts_at, r.ends_at, r.template_id)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}
        </>
      )}

      <ApplyForm key={hash} hash={hash} total={total} />
    </div>
  );
}
