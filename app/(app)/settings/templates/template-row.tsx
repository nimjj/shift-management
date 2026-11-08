"use client";

import { useCallback, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import type { ShiftTemplate } from "@/lib/database.types";
import { updateTemplate } from "./actions";
import { TemplateForm } from "./template-form";

export type TemplateRowData = {
  template: ShiftTemplate;
  /** "Fri 16:00–22:00" in the block's own zone */
  schedule: string;
  zoneLabel: string;
  /** next occurrence in the display zone, e.g. "Sat 7 Nov 03:30–09:30 GMT+5:30" (null if none soon) */
  nextInDisplayZone: string | null;
};

export function TemplateRow({ row, clientTz }: { row: TemplateRowData; clientTz: string }) {
  const { template } = row;
  const [editing, setEditing] = useState(false);
  const close = useCallback(() => setEditing(false), []);

  return (
    <>
      <TableRow className={template.active ? "" : "opacity-60"}>
        <TableCell>
          <span className="inline-flex items-center gap-2 font-medium">
            <span className="inline-block size-3 rounded-full" style={{ backgroundColor: template.colour }} />
            {template.code}
          </span>
        </TableCell>
        <TableCell>{template.name}</TableCell>
        <TableCell>
          {row.schedule} <span className="text-muted-foreground">{row.zoneLabel}</span>
        </TableCell>
        <TableCell>{row.nextInDisplayZone ?? "—"}</TableCell>
        <TableCell>{template.required_headcount}</TableCell>
        <TableCell>
          <Badge variant={template.active ? "secondary" : "outline"}>{template.active ? "Active" : "Archived"}</Badge>
        </TableCell>
        <TableCell className="text-right">
          <Button variant="outline" size="sm" onClick={() => setEditing((v) => !v)}>
            {editing ? "Cancel" : "Edit"}
          </Button>
        </TableCell>
      </TableRow>
      {editing ? (
        <TableRow>
          <TableCell colSpan={7} className="bg-muted/30 p-4">
            <TemplateForm
              template={template}
              action={updateTemplate}
              submitLabel="Save changes"
              clientTz={clientTz}
              onDone={close}
            />
            <p className="mt-3 text-xs text-muted-foreground">
              Saving doesn&apos;t change shifts that already exist. To apply this to them, use{" "}
              <a href="/shifts/regenerate" className="underline underline-offset-4">
                Shifts › Review &amp; regenerate
              </a>
              , which shows a preview first.
            </p>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}
