import { z } from "zod";
import { isValidTimeZone } from "@/lib/time";

const base = {
  full_name: z.string().trim().min(1, "Name is required").max(100),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email")),
  role: z.enum(["supervisor", "agent"]),
  display_tz: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .refine((v) => v === null || isValidTimeZone(v), "Unknown time zone (use e.g. Asia/Colombo)"),
  active: z.boolean(),
};

export const createEmployeeSchema = z.object(base);
export const updateEmployeeSchema = z.object({ id: z.uuid(), ...base });

/** FormData -> plain object for the schemas (checkbox "on" -> boolean). */
export function employeeFormToObject(fd: FormData) {
  return {
    id: fd.get("id")?.toString(),
    full_name: fd.get("full_name")?.toString() ?? "",
    email: fd.get("email")?.toString() ?? "",
    role: fd.get("role")?.toString() ?? "agent",
    display_tz: fd.get("display_tz")?.toString() ?? "",
    active: fd.get("active") === "on",
  };
}
