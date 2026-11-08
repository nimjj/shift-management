import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Employee } from "@/lib/database.types";

/**
 * The signed-in, active employee (or null). Cached per request.
 * Uses getUser() (validates the JWT with Supabase), never getSession().
 */
export const getCurrentEmployee = cache(async (): Promise<Employee | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("employees")
    .select("*")
    .eq("auth_user_id", user.id)
    .eq("active", true)
    .maybeSingle();

  return data;
});

export async function requireEmployee(): Promise<Employee> {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");
  return employee;
}

export async function requireSupervisor(): Promise<Employee> {
  const employee = await requireEmployee();
  if (employee.role !== "supervisor") redirect("/");
  return employee;
}
