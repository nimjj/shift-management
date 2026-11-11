/**
 * A plain warning that a server-side integration is not set up yet. Shows only whether each
 * variable is present, never a value.
 */
export function IntegrationNotice({ items }: { items: { ok: boolean; label: string; missing: string }[] }) {
  const off = items.filter((i) => !i.ok);
  if (off.length === 0) return null;
  return (
    <div
      role="note"
      className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
    >
      <p className="font-medium">Not connected yet</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {off.map((i) => (
          <li key={i.label}>
            {i.label}: set <code className="text-xs">{i.missing}</code> on the server (see SETUP.md).
          </li>
        ))}
      </ul>
    </div>
  );
}
