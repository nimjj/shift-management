"use client";

import { useActionState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Employee } from "@/lib/database.types";
import type { FormState } from "./actions";

export type EmployeeWithPrefs = Employee & {
  employee_notification_prefs: { display_tz: string | null } | null;
};

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function EmployeeForm({
  employee,
  action,
  submitLabel,
  isSelf = false,
  onDone,
}: {
  employee?: EmployeeWithPrefs;
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  isSelf?: boolean;
  onDone?: () => void;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  useEffect(() => {
    if (state?.ok) onDone?.();
  }, [state, onDone]);

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  const err = (name: string) => fieldErrors?.[name]?.[0];

  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-2">
      {employee ? <input type="hidden" name="id" value={employee.id} /> : null}

      <div className="space-y-1">
        <Label htmlFor={`name-${employee?.id ?? "new"}`}>Full name</Label>
        <Input id={`name-${employee?.id ?? "new"}`} name="full_name" defaultValue={employee?.full_name} required />
        {err("full_name") ? <p className="text-xs text-destructive">{err("full_name")}</p> : null}
      </div>

      <div className="space-y-1">
        <Label htmlFor={`email-${employee?.id ?? "new"}`}>Work email</Label>
        <Input
          id={`email-${employee?.id ?? "new"}`}
          name="email"
          type="email"
          defaultValue={employee?.email}
          readOnly={isSelf}
          required
        />
        {err("email") ? <p className="text-xs text-destructive">{err("email")}</p> : null}
      </div>

      <div className="space-y-1">
        <Label htmlFor={`role-${employee?.id ?? "new"}`}>Role</Label>
        <select
          id={`role-${employee?.id ?? "new"}`}
          name="role"
          defaultValue={employee?.role ?? "agent"}
          className={selectClass}
        >
          <option value="agent">Agent</option>
          <option value="supervisor">Supervisor</option>
        </select>
      </div>

      <div className="space-y-1">
        <Label htmlFor={`tz-${employee?.id ?? "new"}`}>Display time zone (optional)</Label>
        <Input
          id={`tz-${employee?.id ?? "new"}`}
          name="display_tz"
          placeholder="Asia/Colombo"
          defaultValue={employee?.employee_notification_prefs?.display_tz ?? ""}
        />
        {err("display_tz") ? <p className="text-xs text-destructive">{err("display_tz")}</p> : null}
      </div>

      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="active" defaultChecked={employee?.active ?? true} />
        Active (can sign in and be assigned to shifts)
      </label>

      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
        {state && !state.ok ? (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
