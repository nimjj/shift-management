"use client";

import { useCallback, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { Pill } from "@/components/status-chip";
import { updateEmployee } from "./actions";
import { EmployeeForm, type EmployeeWithPrefs } from "./employee-form";

export function EmployeeRow({ employee, isSelf }: { employee: EmployeeWithPrefs; isSelf: boolean }) {
  const [editing, setEditing] = useState(false);
  const close = useCallback(() => setEditing(false), []);

  return (
    <>
      <TableRow className={employee.active ? "" : "opacity-60"}>
        <TableCell className="font-medium">
          {employee.full_name}
          {isSelf ? <span className="ml-2 text-xs text-muted-foreground">(you)</span> : null}
        </TableCell>
        <TableCell>{employee.email}</TableCell>
        <TableCell>
          <Badge variant={employee.role === "supervisor" ? "default" : "secondary"}>{employee.role}</Badge>
        </TableCell>
        <TableCell>{employee.employee_notification_prefs?.display_tz ?? "—"}</TableCell>
        <TableCell>
          <span className="flex flex-wrap gap-1">
            <Pill tone="green">email</Pill>
            {employee.telegram_chat_id ? <Pill tone="green">Telegram linked</Pill> : <Pill>no Telegram</Pill>}
          </span>
        </TableCell>
        <TableCell>{employee.active ? "Active" : "Inactive"}</TableCell>
        <TableCell className="text-right">
          <Button variant="outline" size="sm" onClick={() => setEditing((v) => !v)}>
            {editing ? "Cancel" : "Edit"}
          </Button>
        </TableCell>
      </TableRow>
      {editing ? (
        <TableRow>
          <TableCell colSpan={7} className="bg-muted/30 p-4">
            <EmployeeForm
              employee={employee}
              action={updateEmployee}
              submitLabel="Save changes"
              isSelf={isSelf}
              onDone={close}
            />
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}
