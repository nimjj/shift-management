"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { ActionError, supervisorAction, type ActionResult } from "@/lib/actions";
import { copyPairs, gridRange, gridWeeks, normaliseAssignees, type GridShift } from "@/lib/assignments";
import { syncCalendar, syncCalendarQuietly } from "@/lib/calendar-sync";
import { formatLocalDate } from "@/lib/time";
import type { MutationData } from "@/lib/mutate";
import { assignmentsFormToObject, copyWeekSchema, setAssignmentsSchema } from "./schema";

export type SetAssignmentsState = ActionResult<MutationData["set_shift_assignments"]> | null;
export type CopyWeekState = ActionResult<MutationData["copy_week_assignments"]> | null;

function revalidate() {
  for (const p of ["/grid", "/my-shifts", "/shifts/regenerate", "/"]) revalidatePath(p);
}

/**
 * Sets the whole roster of one shift: assign, reassign and unassign are all this one call, so the
 * database never sees a half-changed cell and there is exactly one audit row per edit.
 */
export async function setAssignmentsAction(
  _prev: SetAssignmentsState,
  formData: FormData,
): Promise<SetAssignmentsState> {
  const result = await supervisorAction(setAssignmentsSchema, assignmentsFormToObject(formData), async ({ input, mutate }) =>
    mutate("set_shift_assignments", {
      p_shift_id: input.shift_id,
      p_assignees: normaliseAssignees(input.assignees),
    }),
  );
  if (result.ok) {
    revalidate();
    // The roster is saved. Invites go out afterwards and can never block or undo the change:
    // new assignments are 'pending', removed ones are queued for cancellation by a trigger.
    after(() => syncCalendarQuietly());
  }
  return result;
}

/**
 * "Copy a week": fills only the EMPTY cells of the target week from the same blocks in the source
 * week, so it can never overwrite a roster. Anything it skipped is reported back.
 */
export async function copyWeekAction(_prev: CopyWeekState, formData: FormData): Promise<CopyWeekState> {
  const result = await supervisorAction(
    copyWeekSchema,
    {
      offset: formData.get("offset")?.toString() ?? "0",
      from_index: formData.get("from_index")?.toString() ?? "",
      to_index: formData.get("to_index")?.toString() ?? "",
    },
    async ({ supabase, input, mutate }) => {
      if (input.from_index === input.to_index) throw new ActionError("Pick two different weeks.");

      const orgRes = await supabase.from("org_settings").select("client_tz, week_start").eq("id", 1).single();
      if (orgRes.error) throw orgRes.error;

      const weeks = gridWeeks(new Date(), orgRes.data, input.offset);
      if (!weeks[input.from_index] || !weeks[input.to_index]) {
        throw new ActionError("That week is not on screen any more. Reload the grid.");
      }

      const { from, to } = gridRange(weeks);
      const shiftsRes = await supabase
        .from("shifts")
        .select("id, template_id, occurrence_date, starts_at, ends_at")
        .not("template_id", "is", null)
        .gte("occurrence_date", formatLocalDate(from))
        .lt("occurrence_date", formatLocalDate(to))
        .limit(2000);
      if (shiftsRes.error) throw shiftsRes.error;

      const pairs = copyPairs(shiftsRes.data as GridShift[], weeks, input.from_index, input.to_index);
      if (pairs.length === 0) {
        throw new ActionError(
          "Nothing to copy: those two weeks have no blocks in common. Generate the target week's shifts first.",
        );
      }
      return mutate("copy_week_assignments", { p_pairs: pairs });
    },
  );
  if (result.ok) {
    revalidate();
    after(() => syncCalendarQuietly());
  }
  return result;
}

export type RetryInviteState = ActionResult<{ status: string }> | null;

/**
 * "Retry invite". The audited function resets the attempt counter, then the invite is sent now so
 * the supervisor sees the outcome straight away. Idempotent: the event id comes from the
 * assignment id, so pressing it twice still leaves exactly one event.
 */
export async function retryInviteAction(_prev: RetryInviteState, formData: FormData): Promise<RetryInviteState> {
  const result = await supervisorAction(
    z.object({ assignment_id: z.string().uuid() }),
    { assignment_id: formData.get("assignment_id")?.toString() ?? "" },
    async ({ supabase, input, mutate }) => {
      await mutate("retry_calendar_invite", { p_assignment_id: input.assignment_id });
      await syncCalendar({ assignmentIds: [input.assignment_id] });
      const { data } = await supabase
        .from("assignments")
        .select("calendar_status, calendar_error")
        .eq("id", input.assignment_id)
        .maybeSingle();
      if (data?.calendar_status === "failed") {
        throw new ActionError(data.calendar_error ?? "The invite could not be sent.");
      }
      return { status: data?.calendar_status ?? "pending" };
    },
  );
  revalidate();
  return result;
}
