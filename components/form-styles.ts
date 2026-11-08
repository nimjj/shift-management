/** Native <select> styled to match the shadcn Input. */
export const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/** Block colour choices (hex). The database accepts any #rrggbb. */
export const BLOCK_COLOURS = [
  "#6366f1", // indigo
  "#0ea5e9", // sky
  "#14b8a6", // teal
  "#22c55e", // green
  "#f59e0b", // amber
  "#ef4444", // red
  "#a855f7", // purple
  "#64748b", // slate
] as const;
