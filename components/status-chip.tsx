import {
  ASSIGNMENT_STATUS_LABEL,
  SHIFT_STATUS_LABEL,
  type AssignmentStatus,
  type ShiftStatus,
} from "@/lib/status";

const BASE = "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap";

const GREY = "border-border bg-muted text-muted-foreground";
const BLUE = "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300";
const GREEN = "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
const AMBER = "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300";
const RED = "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-300";

const ASSIGNMENT_STYLE: Record<AssignmentStatus, string> = {
  upcoming: GREY,
  checkin_open: BLUE,
  checked_in: GREEN,
  late: AMBER,
  missed: RED,
};

const SHIFT_STYLE: Record<ShiftStatus, string> = {
  upcoming: GREY,
  covered: GREEN,
  partial: AMBER,
  uncovered: RED,
};

export function AssignmentChip({ status }: { status: AssignmentStatus }) {
  return <span className={`${BASE} ${ASSIGNMENT_STYLE[status]}`}>{ASSIGNMENT_STATUS_LABEL[status]}</span>;
}

export function ShiftChip({ status }: { status: ShiftStatus }) {
  return <span className={`${BASE} ${SHIFT_STYLE[status]}`}>{SHIFT_STATUS_LABEL[status]}</span>;
}

/** A small neutral or warning pill for things that are not a derived status (calendar state, tags). */
export function Pill({ tone = "grey", children }: { tone?: "grey" | "green" | "amber" | "red" | "blue"; children: React.ReactNode }) {
  const style = { grey: GREY, green: GREEN, amber: AMBER, red: RED, blue: BLUE }[tone];
  return <span className={`${BASE} ${style}`}>{children}</span>;
}
