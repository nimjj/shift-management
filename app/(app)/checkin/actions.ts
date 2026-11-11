"use server";

import { revalidatePath } from "next/cache";
import { requireEmployee } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type CheckInStatus = "ok" | "already" | "too_early" | "closed" | "not_yours" | "not_found" | "error";

export type CheckInState = {
  status: CheckInStatus;
  checkedInAt?: string;
  opensAt?: string;
  closesAt?: string;
} | null;

const STATUSES: readonly CheckInStatus[] = ["ok", "already", "too_early", "closed", "not_yours", "not_found"];

/**
 * An agent checking in to their own shift. Everything is decided inside the check_in() database
 * function: it matches the token to the signed-in employee, enforces the window, and sets
 * checked_in_at only if it was empty, so a second call changes nothing.
 */
export async function checkInAction(_prev: CheckInState, formData: FormData): Promise<CheckInState> {
  await requireEmployee();
  const token = formData.get("token")?.toString() ?? "";
  if (!/^[0-9a-f]{32,128}$/.test(token)) return { status: "not_found" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("check_in", { p_token: token });
  if (error) {
    console.error("check_in failed", error);
    return { status: "error" };
  }

  const result = (data ?? {}) as { status?: string; checked_in_at?: string; opens_at?: string; closes_at?: string };
  const status = STATUSES.find((s) => s === result.status) ?? "error";

  if (status === "ok") {
    revalidatePath("/my-shifts");
    revalidatePath("/");
    revalidatePath("/grid");
    revalidatePath(`/checkin/${token}`);
  }
  return { status, checkedInAt: result.checked_in_at, opensAt: result.opens_at, closesAt: result.closes_at };
}
