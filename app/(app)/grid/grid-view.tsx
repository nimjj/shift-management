"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { selectClass } from "@/components/form-styles";
import { AssignmentChip, Pill, ShiftChip } from "@/components/status-chip";
import type { AssignmentStatus, ShiftStatus } from "@/lib/status";
import { ASSIGNMENT_ROLES, COPY_SKIP_LABELS, coverageOf, type AssignmentRole } from "@/lib/assignments";
import { copyWeekAction, retryInviteAction, setAssignmentsAction } from "./actions";

export type GridModel = {
  offset: number;
  clientTz: string;
  displayTz: string;
  calendarEnabled: boolean;
  employees: { id: string; full_name: string; role: string }[];
  weeks: { key: string; label: string }[];
  rows: {
    id: string;
    code: string;
    name: string;
    colour: string;
    active: boolean;
    requiredHeadcount: number;
    cells: (GridCell | null)[];
  }[];
};

export type GridCell = {
  shiftId: string;
  clientTime: string;
  displayTime: string;
  startsAt: string;
  finished: boolean;
  started: boolean;
  status: ShiftStatus;
  assignees: {
    assignmentId: string;
    employeeId: string;
    role: AssignmentRole;
    checkedIn: boolean;
    status: AssignmentStatus;
    calendar: string;
    calendarError: string | null;
  }[];
};

type Selection = { rowIndex: number; weekIndex: number };

/** This Button has no asChild, so week navigation is a Link wearing the button's classes. */
const navLink = buttonVariants({ variant: "outline", size: "sm" });

const COVERAGE_STYLE: Record<ReturnType<typeof coverageOf>, string> = {
  empty: "text-muted-foreground",
  short: "text-amber-600 dark:text-amber-500",
  met: "",
  over: "text-sky-600 dark:text-sky-400",
};

export function GridView({ model }: { model: GridModel }) {
  const [selected, setSelected] = useState<Selection | null>(null);

  const names = useMemo(() => new Map(model.employees.map((e) => [e.id, e.full_name])), [model.employees]);
  const row = selected ? model.rows[selected.rowIndex] : null;
  const cell = selected && row ? row.cells[selected.weekIndex] : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Assignment grid</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            One row per block, one column per week — the old sheet, with a check on every change. Click a cell to set
            who works it.
          </p>
        </div>
        <nav className="flex items-center gap-2 text-sm">
          <Link href={`/grid?w=${model.offset - 1}`} className={navLink}>
            ‹ Earlier
          </Link>
          {model.offset === 0 ? null : (
            <Link href="/grid" className={navLink}>
              This week
            </Link>
          )}
          <Link href={`/grid?w=${model.offset + 1}`} className={navLink}>
            Later ›
          </Link>
        </nav>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-40">Block</TableHead>
              {model.weeks.map((w) => (
                <TableHead key={w.key} className="min-w-44">
                  Week of {w.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {model.rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={model.weeks.length + 1} className="text-sm text-muted-foreground">
                  No blocks yet. Add them under Settings › Shift templates.
                </TableCell>
              </TableRow>
            ) : null}
            {model.rows.map((r, rowIndex) => (
              <TableRow key={r.id} className={r.active ? "" : "opacity-60"}>
                <TableCell className="align-top">
                  <span className="inline-flex items-center gap-2 font-medium">
                    <span className="inline-block size-3 rounded-full" style={{ backgroundColor: r.colour }} />
                    {r.code}
                  </span>
                  <div className="text-xs text-muted-foreground">{r.name}</div>
                  <div className="text-xs text-muted-foreground">needs {r.requiredHeadcount}</div>
                </TableCell>
                {r.cells.map((c, weekIndex) => {
                  const isSelected = selected?.rowIndex === rowIndex && selected?.weekIndex === weekIndex;
                  return (
                    <TableCell key={`${r.id}-${weekIndex}`} className="align-top">
                      {c === null ? (
                        <span className="text-xs text-muted-foreground">not generated</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setSelected(isSelected ? null : { rowIndex, weekIndex })}
                          className={`w-full rounded-lg border p-2 text-left text-sm hover:bg-muted/60 ${
                            isSelected ? "border-ring ring-3 ring-ring/50" : "border-transparent"
                          }`}
                        >
                          <CellBody cell={c} required={r.requiredHeadcount} names={names} />
                        </button>
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {row && cell ? (
        <CellEditor
          key={cell.shiftId}
          block={`${row.code} — ${row.name}`}
          required={row.requiredHeadcount}
          cell={cell}
          employees={model.employees}
          clientTz={model.clientTz}
          displayTz={model.displayTz}
          calendarEnabled={model.calendarEnabled}
          names={names}
          onClose={() => setSelected(null)}
        />
      ) : null}

      <CopyWeekCard weeks={model.weeks} offset={model.offset} />
    </div>
  );
}

function CellBody({
  cell,
  required,
  names,
}: {
  cell: GridCell;
  required: number;
  names: Map<string, string>;
}) {
  const primaries = cell.assignees.filter((a) => a.role === "primary");
  const coverage = coverageOf(primaries.length, required);

  return (
    <>
      <div className="text-xs text-muted-foreground">{cell.displayTime}</div>
      {cell.assignees.length === 0 ? (
        <div className={`mt-1 ${COVERAGE_STYLE.empty}`}>Nobody assigned</div>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {cell.assignees.map((a) => (
            <li key={a.employeeId} className="flex items-center gap-1.5">
              <span>{names.get(a.employeeId) ?? "Unknown"}</span>
              {a.role === "backup" ? (
                <Badge variant="outline" className="px-1 py-0 text-[10px]">
                  backup
                </Badge>
              ) : null}
              {a.status === "upcoming" ? null : <AssignmentChip status={a.status} />}
              {a.calendar === "failed" ? (
                <span title={a.calendarError ?? "The calendar invite failed"}>
                  <Pill tone="amber">invite failed</Pill>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <div className={`mt-1 flex flex-wrap items-center gap-1.5 text-xs ${COVERAGE_STYLE[coverage]}`}>
        <span>
          {primaries.length}/{required}
          {cell.finished ? " · finished" : cell.started ? " · running" : ""}
        </span>
        {cell.status === "upcoming" ? null : <ShiftChip status={cell.status} />}
      </div>
    </>
  );
}

function CellEditor({
  block,
  required,
  cell,
  employees,
  clientTz,
  displayTz,
  calendarEnabled,
  names,
  onClose,
}: {
  calendarEnabled: boolean;
  names: Map<string, string>;
  block: string;
  required: number;
  cell: GridCell;
  employees: GridModel["employees"];
  clientTz: string;
  displayTz: string;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(setAssignmentsAction, null);

  // employeeId -> role, or absent when not assigned.
  const [roster, setRoster] = useState<Record<string, AssignmentRole>>(() =>
    Object.fromEntries(cell.assignees.map((a) => [a.employeeId, a.role])),
  );

  useEffect(() => {
    if (state?.ok) onClose();
  }, [state, onClose]);

  const checkedIn = new Set(cell.assignees.filter((a) => a.checkedIn).map((a) => a.employeeId));
  const primaries = Object.values(roster).filter((r) => r === "primary").length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{block}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm text-muted-foreground">
          <div>
            {cell.clientTime} <span className="text-xs">({clientTz})</span>
          </div>
          <div>
            {cell.displayTime} <span className="text-xs">({displayTz})</span>
          </div>
        </div>

        {cell.finished ? (
          <p className="text-sm">This shift has finished, so its roster can no longer be changed.</p>
        ) : (
          <form action={formAction} className="space-y-4">
            <input type="hidden" name="shift_id" value={cell.shiftId} />

            <ul className="space-y-2">
              {employees.map((e) => {
                const role = roster[e.id];
                const assigned = role !== undefined;
                const locked = checkedIn.has(e.id);
                return (
                  <li key={e.id} className="flex flex-wrap items-center gap-3 text-sm">
                    <label className="flex min-w-56 items-center gap-2">
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={assigned}
                        disabled={locked}
                        onChange={(ev) =>
                          setRoster((prev) => {
                            const next = { ...prev };
                            if (ev.target.checked) next[e.id] = "primary";
                            else delete next[e.id];
                            return next;
                          })
                        }
                      />
                      <span>{e.full_name}</span>
                      {e.role === "supervisor" ? (
                        <Badge variant="outline" className="px-1 py-0 text-[10px]">
                          supervisor
                        </Badge>
                      ) : null}
                    </label>

                    {assigned ? (
                      <select
                        aria-label={`${e.full_name}'s role on this shift`}
                        className={`${selectClass} w-28`}
                        value={role}
                        onChange={(ev) =>
                          setRoster((prev) => ({ ...prev, [e.id]: ev.target.value as AssignmentRole }))
                        }
                      >
                        {ASSIGNMENT_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    ) : null}

                    {locked ? <span className="text-xs text-muted-foreground">checked in — can&apos;t remove</span> : null}

                    {assigned ? <input type="hidden" name="assignee" value={`${e.id}:${role}`} /> : null}
                  </li>
                );
              })}
            </ul>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save roster"}
              </Button>
              <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
                Cancel
              </Button>
              <span className="text-sm text-muted-foreground">
                {primaries} of {required} needed
                {primaries > required ? " (more than needed)" : ""}
              </span>
            </div>

            {state && !state.ok ? (
              <p role="alert" className="text-sm text-destructive">
                {state.error}
              </p>
            ) : null}
          </form>
        )}

        {calendarEnabled && cell.assignees.length > 0 ? (
          <div className="space-y-2 border-t pt-3">
            <h3 className="text-sm font-medium">Calendar invites</h3>
            <ul className="space-y-2">
              {cell.assignees.map((a) => (
                <InviteRow key={a.assignmentId} assignee={a} name={names.get(a.employeeId) ?? "Unknown"} />
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

const CALENDAR_TONE: Record<string, "grey" | "green" | "amber"> = {
  sent: "green",
  failed: "amber",
  pending: "grey",
  disabled: "grey",
};

function InviteRow({ assignee, name }: { assignee: GridCell["assignees"][number]; name: string }) {
  const [state, formAction, pending] = useActionState(retryInviteAction, null);
  const failed = assignee.calendar === "failed";

  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <span className="min-w-32">{name}</span>
      <Pill tone={CALENDAR_TONE[assignee.calendar] ?? "grey"}>
        {assignee.calendar === "sent" ? "invite sent" : assignee.calendar === "pending" ? "sending…" : `invite ${assignee.calendar}`}
      </Pill>
      <form action={formAction}>
        <input type="hidden" name="assignment_id" value={assignee.assignmentId} />
        <Button type="submit" size="xs" variant="outline" disabled={pending}>
          {pending ? "Sending…" : failed ? "Retry invite" : "Resend invite"}
        </Button>
      </form>
      {state?.ok ? <span className="text-xs text-muted-foreground">Sent.</span> : null}
      {state && !state.ok ? (
        <span role="alert" className="text-xs text-destructive">
          {state.error}
        </span>
      ) : failed && assignee.calendarError ? (
        <span className="text-xs text-muted-foreground">{assignee.calendarError}</span>
      ) : null}
    </li>
  );
}

function CopyWeekCard({ weeks, offset }: { weeks: GridModel["weeks"]; offset: number }) {
  const [state, formAction, pending] = useActionState(copyWeekAction, null);
  const [fromIndex, setFromIndex] = useState("0");
  const [toIndex, setToIndex] = useState(weeks.length > 1 ? "1" : "0");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Copy a week</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <form action={formAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="offset" value={offset} />
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">From</span>
            <select name="from_index" className={`${selectClass} w-44`} value={fromIndex} onChange={(e) => setFromIndex(e.target.value)}>
              {weeks.map((w, i) => (
                <option key={w.key} value={i}>
                  {w.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">To</span>
            <select name="to_index" className={`${selectClass} w-44`} value={toIndex} onChange={(e) => setToIndex(e.target.value)}>
              {weeks.map((w, i) => (
                <option key={w.key} value={i}>
                  {w.label}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" variant="outline" disabled={pending || fromIndex === toIndex}>
            {pending ? "Copying…" : "Copy"}
          </Button>
        </form>

        <p className="text-xs text-muted-foreground">
          Fills only the cells that are still empty, so it can never overwrite a roster.
        </p>

        {state?.ok ? (
          <div className="text-sm">
            <p>
              Filled {state.data.shifts_filled} shift{state.data.shifts_filled === 1 ? "" : "s"} with{" "}
              {state.data.assignments_created} assignment{state.data.assignments_created === 1 ? "" : "s"}.
            </p>
            {state.data.skipped.length > 0 ? (
              <ul className="mt-1 text-muted-foreground">
                {Object.entries(
                  state.data.skipped.reduce<Record<string, number>>((acc, s) => {
                    acc[s.reason] = (acc[s.reason] ?? 0) + 1;
                    return acc;
                  }, {}),
                ).map(([reason, count]) => (
                  <li key={reason}>
                    {count} skipped: {COPY_SKIP_LABELS[reason as keyof typeof COPY_SKIP_LABELS] ?? reason}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {state && !state.ok ? (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
