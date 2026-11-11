/** The "Saved." / error line under a form that uses useActionState with an ActionResult. */
export function FormStatus({
  state,
  saved = "Saved.",
}: {
  state: { ok: true } | { ok: false; error: string } | null;
  saved?: string;
}) {
  if (!state) return null;
  return state.ok ? (
    <p role="status" className="text-sm text-muted-foreground">
      {saved}
    </p>
  ) : (
    <p role="alert" className="text-sm text-destructive">
      {state.error}
    </p>
  );
}

/** First validation message for a field, if any. */
export function fieldError(
  state: { ok: boolean; fieldErrors?: Record<string, string[] | undefined> } | null,
  name: string,
): string | undefined {
  return state && !state.ok ? state.fieldErrors?.[name]?.[0] : undefined;
}
