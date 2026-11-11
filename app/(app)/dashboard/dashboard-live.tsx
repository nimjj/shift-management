"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AssignmentChip, Pill, ShiftChip } from "@/components/status-chip";
import { formatInstant } from "@/lib/rules/template";
import type { CheckinRules } from "@/lib/settings";
import { assignmentStatus, checkinDelayMinutes, shiftStatus } from "@/lib/status";
import { createClient } from "@/lib/supabase/client";

export type DashShift = {
  id: string;
  block: string;
  name: string;
  colour: string;
  isTest: boolean;
  starts_at: string;
  ends_at: string;
  displayRange: string;
  clientRange: string;
  required: number;
  rules: CheckinRules;
  assignees: { id: string; name: string; role: "primary" | "backup"; checked_in_at: string | null }[];
};

const TICK_MS = 30_000;

function minutesUntil(iso: string, now: Date): string {
  const min = Math.round((new Date(iso).getTime() - now.getTime()) / 60_000);
  if (min < 60) return `${Math.max(min, 0)} min`;
  const h = Math.floor(min / 60);
  return h < 48 ? `${h} h ${min % 60} min` : `${Math.floor(h / 24)} days`;
}

function People({ shift, now, tz }: { shift: DashShift; now: Date; tz: string }) {
  if (shift.assignees.length === 0) return <p className="text-sm text-muted-foreground">Nobody is assigned.</p>;
  return (
    <ul className="space-y-1.5">
      {shift.assignees.map((a) => {
        const status = assignmentStatus(a, shift, shift.rules, now);
        const delay = a.checked_in_at ? checkinDelayMinutes(a.checked_in_at, shift) : null;
        return (
          <li key={a.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="min-w-28 font-medium">{a.name}</span>
            {a.role === "backup" ? <Badge variant="outline">backup</Badge> : null}
            <AssignmentChip status={status} />
            {a.checked_in_at ? (
              <span className="text-xs text-muted-foreground">
                {formatInstant(new Date(a.checked_in_at), tz)}
                {delay !== null ? ` (${delay <= 0 ? `${-delay} min early` : `${delay} min after start`})` : ""}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function ShiftPanel({ title, shift, now, tz, note }: { title: string; shift: DashShift; now: Date; tz: string; note: string }) {
  const primaries = shift.assignees.filter((a) => a.role === "primary");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <span className="text-muted-foreground">{title}</span>
          <span className="inline-block size-3 rounded-full" style={{ backgroundColor: shift.colour }} />
          Block {shift.block}
          {shift.isTest ? <Pill tone="blue">test</Pill> : null}
          <ShiftChip status={shiftStatus(primaries, shift, shift.rules, now)} />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-sm text-muted-foreground">
          <div>{shift.displayRange}</div>
          <div>{shift.clientRange} (client)</div>
          <div>{note}</div>
        </div>
        <People shift={shift} now={now} tz={tz} />
      </CardContent>
    </Card>
  );
}

/**
 * The live part of the dashboard. Statuses are derived in the browser from the data plus the clock
 * (re-derived every 30 s, so "late" appears on time), and Supabase Realtime re-fetches the data the
 * moment an assignment or shift changes, so a check-in on a phone turns the chip green here
 * without a reload.
 */
export function DashboardLive({ shifts, tz, serverNow }: { shifts: DashShift[]; tz: string; serverNow: string }) {
  const router = useRouter();
  const [now, setNow] = useState(() => new Date(serverNow));
  const [live, setLive] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let pending: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(pending);
      pending = setTimeout(() => router.refresh(), 250);
    };
    const channel = supabase
      .channel("dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "assignments" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "shifts" }, refresh)
      .subscribe((status) => setLive(status === "SUBSCRIBED"));
    return () => {
      clearTimeout(pending);
      void supabase.removeChannel(channel);
    };
  }, [router]);

  const { current, next, upcoming } = useMemo(() => {
    const t = now.getTime();
    const running = shifts.filter((s) => new Date(s.starts_at).getTime() <= t && t < new Date(s.ends_at).getTime());
    const future = shifts.filter((s) => new Date(s.starts_at).getTime() > t);
    return { current: running, next: future[0], upcoming: future.slice(1) };
  }, [shifts, now]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" role="status">
        <span className={`inline-block size-2 rounded-full ${live ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
        {live ? "Live" : "Connecting…"} · as of {formatInstant(now, tz)}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {current.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base text-muted-foreground">Now</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">No shift is running right now.</p>
            </CardContent>
          </Card>
        ) : (
          current.map((s) => (
            <ShiftPanel key={s.id} title="Now" shift={s} now={now} tz={tz} note={`Ends in ${minutesUntil(s.ends_at, now)}`} />
          ))
        )}
        {next ? (
          <ShiftPanel title="Next" shift={next} now={now} tz={tz} note={`Starts in ${minutesUntil(next.starts_at, now)}`} />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base text-muted-foreground">Next</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">Nothing is scheduled. Generate shifts under Shifts.</p>
            </CardContent>
          </Card>
        )}
      </div>

      {upcoming.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-base font-medium">Upcoming</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Block</TableHead>
                <TableHead>{tz}</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>Staffing</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {upcoming.map((s) => {
                const primaries = s.assignees.filter((a) => a.role === "primary");
                return (
                  <TableRow key={s.id}>
                    <TableCell>
                      <span className="inline-flex items-center gap-2 font-medium">
                        <span className="inline-block size-3 rounded-full" style={{ backgroundColor: s.colour }} />
                        {s.block}
                      </span>
                    </TableCell>
                    <TableCell>{s.displayRange}</TableCell>
                    <TableCell>
                      {s.assignees.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className="flex flex-wrap gap-x-3 gap-y-1">
                          {s.assignees.map((a) => (
                            <span key={a.id} className="inline-flex items-center gap-1.5">
                              {a.name}
                              {a.role === "backup" ? <Badge variant="outline">backup</Badge> : null}
                              {a.checked_in_at ? <AssignmentChip status="checked_in" /> : null}
                            </span>
                          ))}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {primaries.length >= s.required ? (
                        <span className="text-muted-foreground">
                          {primaries.length}/{s.required}
                        </span>
                      ) : (
                        <Pill tone="amber">
                          {primaries.length}/{s.required} assigned
                        </Pill>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </section>
      ) : null}
    </div>
  );
}
